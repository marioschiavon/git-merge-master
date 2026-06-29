// Idempotency helpers shared across calendar actions and inbound webhooks.
// Phase 1 of the SDR-agent refactor: guarantees we never create duplicate
// bookings and never process the same provider message twice.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type CalendarActionType = "book" | "reschedule" | "cancel" | "add_guests";

/** Stable idempotency key for a calendar action. */
export async function buildIdempotencyKey(parts: {
  conversation_id?: string | null;
  lead_id?: string | null;
  action_type: CalendarActionType;
  requested_start?: string | null;
  provider_booking_uid?: string | null;
}): Promise<string> {
  const raw = [
    parts.conversation_id ?? "",
    parts.lead_id ?? "",
    parts.action_type,
    parts.requested_start ?? "",
    parts.provider_booking_uid ?? "",
  ].join("|");
  const data = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CalendarActionRow {
  id: string;
  idempotency_key: string;
  status: "pending" | "ok" | "failed";
  action_type: CalendarActionType;
  provider_booking_uid: string | null;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  error_message: string | null;
}

/**
 * Try to claim an idempotency key. Returns:
 *  - { kind: "existing", row } when an `ok` row already exists (replay it).
 *  - { kind: "pending",  row } when another worker is in-flight; caller should
 *    poll or short-circuit. For now we treat as existing failed=false.
 *  - { kind: "claimed",  row } when this caller may proceed with the action.
 */
export async function claimCalendarAction(
  supabase: SupabaseClient,
  args: {
    idempotency_key: string;
    conversation_id?: string | null;
    lead_id?: string | null;
    company_id?: string | null;
    action_type: CalendarActionType;
    requested_start?: string | null;
    provider_booking_uid?: string | null;
    request_payload: Record<string, unknown>;
  },
): Promise<
  | { kind: "existing"; row: CalendarActionRow }
  | { kind: "pending"; row: CalendarActionRow }
  | { kind: "claimed"; row: CalendarActionRow }
> {
  // 1) Look first; if an "ok" row exists, replay synchronously.
  const { data: found } = await supabase
    .from("calendar_actions")
    .select("*")
    .eq("idempotency_key", args.idempotency_key)
    .maybeSingle();

  if (found) {
    if (found.status === "ok") return { kind: "existing", row: found as CalendarActionRow };
    if (found.status === "pending") return { kind: "pending", row: found as CalendarActionRow };
    // failed: allow retry by overwriting status back to pending
    const { data: retried } = await supabase
      .from("calendar_actions")
      .update({
        status: "pending",
        request_payload: args.request_payload,
        response_payload: {},
        error_message: null,
      })
      .eq("id", found.id)
      .select("*")
      .single();
    return { kind: "claimed", row: retried as CalendarActionRow };
  }

  // 2) Insert new pending row; ON CONFLICT (idempotency_key) returns null and
  // we re-read.
  const { data: inserted, error } = await supabase
    .from("calendar_actions")
    .insert({
      idempotency_key: args.idempotency_key,
      conversation_id: args.conversation_id ?? null,
      lead_id: args.lead_id ?? null,
      company_id: args.company_id ?? null,
      action_type: args.action_type,
      requested_start: args.requested_start ?? null,
      provider_booking_uid: args.provider_booking_uid ?? null,
      request_payload: args.request_payload,
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (error && !/duplicate key|unique/i.test(error.message)) {
    throw error;
  }
  if (inserted) return { kind: "claimed", row: inserted as CalendarActionRow };

  // Lost the race — re-read.
  const { data: race } = await supabase
    .from("calendar_actions")
    .select("*")
    .eq("idempotency_key", args.idempotency_key)
    .single();
  if ((race as CalendarActionRow).status === "ok") {
    return { kind: "existing", row: race as CalendarActionRow };
  }
  return { kind: "pending", row: race as CalendarActionRow };
}

export async function markCalendarActionOk(
  supabase: SupabaseClient,
  id: string,
  patch: { provider_booking_uid?: string | null; response_payload: Record<string, unknown> },
) {
  await supabase
    .from("calendar_actions")
    .update({
      status: "ok",
      provider_booking_uid: patch.provider_booking_uid ?? null,
      response_payload: patch.response_payload,
      error_message: null,
    })
    .eq("id", id);
}

export async function markCalendarActionFailed(
  supabase: SupabaseClient,
  id: string,
  error: unknown,
  response_payload: Record<string, unknown> = {},
) {
  await supabase
    .from("calendar_actions")
    .update({
      status: "failed",
      response_payload,
      error_message: error instanceof Error ? error.message : String(error),
    })
    .eq("id", id);
}

/** Service-role Supabase client (lazy) for shared usage. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Insert an inbound message with provider-level dedup.
 * Returns the inserted row, or `null` when the provider_message_id was already
 * recorded (caller must skip downstream processing).
 */
export async function insertInboundMessageDedup(
  supabase: SupabaseClient,
  row: {
    conversation_id: string;
    content: string;
    channel?: string | null;
    provider: string;
    provider_message_id: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ inserted: boolean; id?: string }> {
  if (row.provider_message_id) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("provider", row.provider)
      .eq("provider_message_id", row.provider_message_id)
      .maybeSingle();
    if (existing) return { inserted: false, id: existing.id };
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: row.conversation_id,
      content: row.content,
      direction: "inbound",
      channel: row.channel ?? null,
      ai_suggested: false,
      metadata: row.metadata ?? {},
      provider: row.provider,
      provider_message_id: row.provider_message_id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return { inserted: false };
    throw error;
  }
  return { inserted: true, id: data?.id };
}
