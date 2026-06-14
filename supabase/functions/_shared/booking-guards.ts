// booking-guards.ts — Phase 4.
// Centralized pre-flight checks for book_slot / reschedule_booking / cancel_booking.
//
// `assertCanBook` runs the 4 guards described in the refactor plan, in order:
//   1. Active booking conflict
//      - book_slot is blocked if a confirmed/pending booking already exists (force reschedule).
//      - reschedule_booking / cancel_booking require an active booking.
//   2. Idempotency replay (caller handles via claimCalendarAction; the guard exposes
//      a normalized slot ISO and computed idempotency context so the caller can claim).
//   3. Slot must belong to a current `slot_holds` row OR to recently offered slots
//      (memory.facts.offered_slots_pending OR implicit single-slot offer in last outbound),
//      with ±5min tolerance. Lead must have given explicit confirmation OR an
//      unambiguous slot reference in the last inbound message.
//   4. Light Cal.com reconfirmation: when a held slot is matched but its hold has
//      already expired, refresh it via `calcom-slots` (`check_datetime`) before the
//      final booking call. If unavailable, downgrade and surface alternatives.
//
// On any failure the guard returns `{ ok: false, downgrade?, error_code, suggested_message? }`
// so the caller can turn it into a tool result for the model to recover.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type BookingOp = "book_slot" | "reschedule_booking" | "cancel_booking";

export interface HoldRow {
  id: string;
  slot_datetime: string;
  status: string;
  expires_at: string | null;
}

export interface BookingRow {
  id: string;
  calcom_booking_uid: string | null;
  status: string;
  scheduled_at: string | null;
  updated_at: string | null;
}

export interface AssertCanBookDeps {
  facts: Record<string, unknown>;
  holds: HoldRow[];
  bookings: BookingRow[];
  lastInbound: string;
  lastOutbound: string;
  // Pure helpers injected from sdr-agent to avoid duplication.
  isLikelyConfirmation: (text: string) => boolean;
  matchesSlotReference: (text: string, candidateIsos: string[]) => { iso: string | null; ambiguous: boolean };
  implicitOfferFromOutbound: (outbound: string, candidates: string[]) => string | null;
  parseSlotStartAsBrt: (s: string) => number;
  formatBRTLong: (iso: string) => string;
  // Lead/company context (for the optional calcom-slots refresh call).
  lead_id: string;
  company_id: string;
  conversation_id?: string | null;
}

export type AssertCanBookResult =
  | {
      ok: true;
      slotIso: string;
      slotEpochMs: number;
      matchedHold: HoldRow | null;
      activeBookingUid: string | null;
    }
  | {
      ok: false;
      error_code:
        | "active_booking_conflict"
        | "no_active_booking"
        | "missing_slot_start"
        | "slot_not_offered"
        | "no_confirmation"
        | "no_matching_hold"
        | "slot_unavailable";
      hint: string;
      downgrade?: "ask_confirmation" | "use_reschedule" | "no_active_booking" | "reoffer_slots";
      suggested_message?: string;
      candidates?: string[];
      next_action?: string;
    };

const FIVE_MIN = 5 * 60_000;
const OFFER_TTL_MS = 30 * 60_000;

function activeBookingOf(bookings: BookingRow[]): BookingRow | null {
  return (
    bookings.find((b) => b.status === "confirmed" || b.status === "pending" || b.status === "rescheduled") ?? null
  );
}

export async function assertCanBook(
  supabase: SupabaseClient,
  op: BookingOp,
  args: Record<string, unknown>,
  deps: AssertCanBookDeps,
): Promise<AssertCanBookResult> {
  const active = activeBookingOf(deps.bookings);

  // ── Guard 1: active booking conflict ────────────────────────────────
  if (op === "book_slot" && active && active.calcom_booking_uid) {
    const when = active.scheduled_at ? deps.formatBRTLong(active.scheduled_at) : "horário registrado";
    return {
      ok: false,
      error_code: "active_booking_conflict",
      downgrade: "use_reschedule",
      hint: `Lead already has an active booking (${active.calcom_booking_uid}). Use reschedule_booking instead of book_slot.`,
      suggested_message:
        `Vi aqui que você já tem uma reunião marcada (${when}). Quer que eu remarque para outro horário?`,
      next_action:
        "Chame `reschedule_booking({ slot_start })` se o lead confirmar um novo horário, ou `finalize` com o suggested_message para perguntar.",
    };
  }
  if ((op === "reschedule_booking" || op === "cancel_booking") && !active) {
    return {
      ok: false,
      error_code: "no_active_booking",
      downgrade: "no_active_booking",
      hint: `No active booking found for this lead — cannot ${op === "cancel_booking" ? "cancel" : "reschedule"}.`,
      suggested_message:
        op === "cancel_booking"
          ? "Não consegui localizar uma reunião ativa pra cancelar. Quer marcar um novo horário?"
          : "Não encontrei nenhuma reunião ativa pra remarcar. Quer que eu envie horários novos?",
      next_action: "Chame `finalize` com decision=send_message usando o suggested_message.",
    };
  }

  // cancel_booking does not need slot validation.
  if (op === "cancel_booking") {
    return {
      ok: true,
      slotIso: "",
      slotEpochMs: NaN,
      matchedHold: null,
      activeBookingUid: active?.calcom_booking_uid ?? null,
    };
  }

  // ── Guard input: slot_start ─────────────────────────────────────────
  const slotStart = typeof args.slot_start === "string" ? args.slot_start : "";
  if (!slotStart) {
    return {
      ok: false,
      error_code: "missing_slot_start",
      hint: "Argument `slot_start` is required and must be an ISO datetime.",
    };
  }
  const target = deps.parseSlotStartAsBrt(slotStart);
  if (!Number.isFinite(target)) {
    return {
      ok: false,
      error_code: "missing_slot_start",
      hint: "Argument `slot_start` could not be parsed as ISO datetime.",
    };
  }

  // ── Guard 3: slot must match an offered/held candidate + explicit confirmation ──
  const heldIsos = deps.holds.map((h) => h.slot_datetime);
  const pendingMeta = deps.facts.offered_slots_pending as
    | { slots?: string[]; offered_at?: string }
    | undefined;
  const pendingFresh = pendingMeta?.offered_at
    ? Date.now() - new Date(pendingMeta.offered_at).getTime() < OFFER_TTL_MS
    : false;
  const pending = (pendingFresh ? pendingMeta?.slots : null) ?? [];
  const candidates: string[] =
    pending.length > 0
      ? pending
      : (() => {
          const implicit = deps.implicitOfferFromOutbound(deps.lastOutbound, heldIsos);
          return implicit ? [implicit] : heldIsos;
        })();

  const explicit = deps.isLikelyConfirmation(deps.lastInbound);
  const ref = deps.matchesSlotReference(deps.lastInbound, candidates);
  const matchesOffered = candidates.some((iso) => Math.abs(new Date(iso).getTime() - target) < FIVE_MIN);
  const hasConfirmation = explicit || !!ref.iso;

  if (!matchesOffered || !hasConfirmation) {
    let suggested_message: string;
    const refIso = ref.iso || (candidates.length === 1 ? candidates[0] : null);
    if (refIso && !ref.ambiguous) {
      suggested_message =
        op === "reschedule_booking"
          ? `Só confirmando: posso remarcar para ${deps.formatBRTLong(refIso)}?`
          : `Só confirmando: posso fechar para ${deps.formatBRTLong(refIso)}?`;
    } else if (candidates.length > 0) {
      const formatted = candidates.slice(0, 3).map((s) => `• ${deps.formatBRTLong(s)}`).join("\n");
      suggested_message = `Antes de ${
        op === "reschedule_booking" ? "remarcar" : "confirmar"
      }, qual destes horários funciona melhor pra você?\n\n${formatted}`;
    } else {
      suggested_message = "Antes de confirmar, qual horário funciona melhor pra você?";
    }
    return {
      ok: false,
      error_code: !matchesOffered ? "slot_not_offered" : "no_confirmation",
      downgrade: "ask_confirmation",
      hint: !matchesOffered
        ? "slot_start does not match any offered or currently held slot (±5min)."
        : "Lead has not given explicit confirmation for this slot in the last inbound message.",
      candidates,
      suggested_message,
      next_action: "Chame finalize com decision=send_message e message=suggested_message.",
    };
  }

  // ── Guard 4: matching hold + light Cal.com refresh if expired ──────
  let matched: HoldRow | null =
    deps.holds.find((h) => h.status === "held" && Math.abs(new Date(h.slot_datetime).getTime() - target) < FIVE_MIN) ??
    null;

  if (op === "book_slot") {
    if (!matched) {
      // No hold at all — try a fresh reconfirmation via calcom-slots.
      const refreshed = await refreshHold(supabase, slotStart, deps);
      if (refreshed.kind === "ok") matched = refreshed.hold;
      else return refreshed.result;
    } else if (matched.expires_at && new Date(matched.expires_at).getTime() < Date.now()) {
      // Hold expired — refresh it.
      const refreshed = await refreshHold(supabase, slotStart, deps);
      if (refreshed.kind === "ok") matched = refreshed.hold;
      else return refreshed.result;
    }
  }

  return {
    ok: true,
    slotIso: slotStart,
    slotEpochMs: target,
    matchedHold: matched,
    activeBookingUid: active?.calcom_booking_uid ?? null,
  };
}

async function refreshHold(
  supabase: SupabaseClient,
  slotStart: string,
  deps: AssertCanBookDeps,
): Promise<
  | { kind: "ok"; hold: HoldRow }
  | { kind: "fail"; result: Extract<AssertCanBookResult, { ok: false }> }
> {
  try {
    const { data, error } = await supabase.functions.invoke("calcom-slots", {
      body: {
        company_id: deps.company_id,
        lead_id: deps.lead_id,
        conversation_id: deps.conversation_id ?? null,
        check_datetime: slotStart,
      },
    });
    if (error) throw error;
    const payload = (data ?? {}) as { available?: boolean; slots?: HoldRow[]; formatted?: string[] };
    if (payload.available && Array.isArray(payload.slots) && payload.slots[0]) {
      return { kind: "ok", hold: payload.slots[0] };
    }
    const formatted = Array.isArray(payload.formatted) ? payload.formatted.slice(0, 3) : [];
    const suggested_message = formatted.length
      ? `Esse horário acabou de ficar indisponível. Posso te oferecer estes?\n\n${formatted.map((s) => `• ${s}`).join("\n")}`
      : `Esse horário não está mais disponível. Quer escolher outro dia/hora?`;
    return {
      kind: "fail",
      result: {
        ok: false,
        error_code: "slot_unavailable",
        downgrade: "reoffer_slots",
        hint: "Cal.com no longer offers this slot. Reoffer alternatives.",
        suggested_message,
      },
    };
  } catch (e) {
    return {
      kind: "fail",
      result: {
        ok: false,
        error_code: "no_matching_hold",
        hint: `Could not refresh slot via calcom-slots: ${String((e as Error)?.message ?? e)}`,
        suggested_message:
          "Tive um problema pra confirmar esse horário agora. Pode escolher outro dia/hora pra eu reservar?",
      },
    };
  }
}
