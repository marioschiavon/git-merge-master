// Shared Cal.com helpers (multi-tenant capable).
//
// Every helper accepts an optional `apiKey` argument. When omitted it falls
// back to the legacy CALCOM_API_KEY env var so the migration to per-company
// keys can happen gradually. New callers should ALWAYS pass the company's
// key resolved via `getCompanyCalcomCreds(supabase, companyId)`.

export const CALCOM_BOOKINGS_API_VERSION = "2024-08-13";
export const CALCOM_EVENT_TYPES_API_VERSION = "2024-06-14";
export const CALCOM_SLOTS_API_VERSION = "2024-09-04";

export function normalizeCalcomApiKey(input?: string | null): string {
  let key = String(input || "").trim();
  key = key.replace(/^authorization\s*:\s*/i, "").trim();
  key = key.replace(/^bearer\s+/i, "").trim();
  key = key.replace(/^api[_ -]?key\s*[:=]\s*/i, "").trim();
  key = key.replace(/^['"`]|['"`]$/g, "").trim();
  return key.replace(/\s+/g, "");
}

export function calcomHeaders(apiKey: string, version = CALCOM_BOOKINGS_API_VERSION) {
  const normalizedKey = normalizeCalcomApiKey(apiKey);
  return {
    Authorization: `Bearer ${normalizedKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

export class CalcomError extends Error {
  status: number;
  body: any;
  path: string;
  constructor(path: string, status: number, body: any) {
    const snippet = typeof body === "string" ? body : JSON.stringify(body ?? null);
    super(`Cal.com ${path} ${status}: ${snippet.slice(0, 500)}`);
    this.name = "CalcomError";
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

function resolveKey(apiKey?: string | null): string {
  const k = normalizeCalcomApiKey(apiKey || Deno.env.get("CALCOM_API_KEY"));
  if (!k) throw new Error("Cal.com API key not configured");
  return k;
}

export async function calcomFetch(
  path: string,
  init: RequestInit & { version?: string; apiKey?: string } = {}
) {
  const apiKey = resolveKey(init.apiKey);
  const { version, headers, apiKey: _drop, ...rest } = init as any;
  const res = await fetch(`https://api.cal.com${path}`, {
    ...rest,
    headers: { ...calcomHeaders(apiKey, version), ...(headers || {}) },
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error(`[calcom] ${path} → ${res.status}`, json?.error || json?.message || text.slice(0, 300));
    throw new CalcomError(path, res.status, json ?? text);
  }
  return json;
}

/** Cancel a confirmed Cal.com booking (POST /v2/bookings/{uid}/cancel) */
export async function cancelCalcomBooking(
  uid: string,
  reason = "Cancelado pelo prospect via conversa",
  apiKey?: string,
): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  let key: string;
  try { key = resolveKey(apiKey); } catch (e: any) {
    return { ok: false, status: 0, body: null, error: e?.message || "no api key" };
  }
  try {
    const res = await fetch(`https://api.cal.com/v2/bookings/${uid}/cancel`, {
      method: "POST",
      headers: calcomHeaders(key, CALCOM_BOOKINGS_API_VERSION),
      body: JSON.stringify({ cancellationReason: reason }),
    });
    const text = await res.text();
    let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    console.log(`[calcom] cancel booking ${uid} → ${res.status} ${res.ok ? "OK" : "FAIL"}`, body?.error || body?.message || "");
    return { ok: res.ok, status: res.status, body, error: res.ok ? undefined : (body?.error?.message || body?.message || text.slice(0, 300)) };
  } catch (e: any) {
    console.error(`[calcom] cancel booking ${uid} threw:`, e);
    return { ok: false, status: 0, body: null, error: e?.message || String(e) };
  }
}

/** Cancel a held slot reservation (DELETE /v2/slots/reservations/{uid}) */
export async function cancelCalcomReservation(
  uid: string,
  apiKey?: string,
): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  let key: string;
  try { key = resolveKey(apiKey); } catch (e: any) {
    return { ok: false, status: 0, body: null, error: e?.message || "no api key" };
  }
  try {
    const res = await fetch(`https://api.cal.com/v2/slots/reservations/${uid}`, {
      method: "DELETE",
      headers: calcomHeaders(key, CALCOM_SLOTS_API_VERSION),
    });
    const text = await res.text();
    let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    console.log(`[calcom] cancel reservation ${uid} → ${res.status} ${res.ok ? "OK" : "FAIL"}`);
    return { ok: res.ok, status: res.status, body, error: res.ok ? undefined : (body?.error?.message || body?.message || text.slice(0, 300)) };
  } catch (e: any) {
    console.error(`[calcom] cancel reservation ${uid} threw:`, e);
    return { ok: false, status: 0, body: null, error: e?.message || String(e) };
  }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cal-signature-256",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Resolve the default Cal.com event type id. Prefers, in order:
 *   1. `preferredEventTypeId` (usually companies.calcom_default_event_type_id)
 *   2. CALCOM_EVENT_TYPE_ID env var (legacy global)
 *   3. First event type returned by the API.
 */
export async function resolveEventTypeId(
  apiKey: string,
  preferredEventTypeId?: number | null,
): Promise<number> {
  if (preferredEventTypeId && !isNaN(Number(preferredEventTypeId))) {
    return Number(preferredEventTypeId);
  }
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) return Number(manualId);

  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch event types from Cal.com: ${res.status}`);
  const json = await res.json();
  const eventTypes = json.data?.eventTypes || json.data || [];
  if (!eventTypes.length) throw new Error("No event types found in Cal.com account");
  return eventTypes[0].id;
}

/** Fetch lengthInMinutes for a given event type id from Cal.com live. */
export async function fetchEventTypeLengthMinutes(
  apiKey: string,
  eventTypeId: number,
): Promise<number | null> {
  try {
    const res = await fetch(`https://api.cal.com/v2/event-types/${eventTypeId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const et = json.data?.eventType || json.data || json;
    const len = et?.lengthInMinutes ?? et?.length;
    return typeof len === "number" && len > 0 ? len : null;
  } catch (_e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Per-company credentials (multi-tenant)
// ─────────────────────────────────────────────────────────────────

export interface CompanyCalcomCreds {
  apiKey: string;
  bookingLink: string | null;
  webhookSecret: string | null;
  defaultEventTypeId: number | null;
  companySlug: string | null;
  source: "company" | "env_fallback";
}

const _credsCache = new Map<string, CompanyCalcomCreds>();

/**
 * Resolve Cal.com credentials for a company. Uses the encrypted key in
 * `companies.calcom_api_key_encrypted` when present, otherwise falls back to
 * the global CALCOM_API_KEY env (transitional).
 *
 * Throws if no credentials are available.
 */
export async function getCompanyCalcomCreds(
  supabase: any,
  companyId: string,
): Promise<CompanyCalcomCreds> {
  if (!companyId) throw new Error("company_id required");
  const cached = _credsCache.get(companyId);
  if (cached) return cached;

  const { data: company, error } = await supabase
    .from("companies")
    .select("slug, calcom_booking_link, calcom_webhook_secret, calcom_default_event_type_id, calcom_api_key_encrypted")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;

  let apiKey: string | null = null;
  let source: "company" | "env_fallback" = "env_fallback";

  if (company?.calcom_api_key_encrypted) {
    const passphrase = Deno.env.get("CALCOM_KEY_PASSPHRASE");
    if (!passphrase) throw new Error("CALCOM_KEY_PASSPHRASE not configured");
    const { data: keyData, error: keyErr } = await supabase.rpc("get_calcom_api_key", {
      _company_id: companyId,
      _passphrase: passphrase,
    });
    if (keyErr) throw keyErr;
    apiKey = keyData as string | null;
    if (apiKey) source = "company";
  }

  if (!apiKey) {
    const envKey = Deno.env.get("CALCOM_API_KEY");
    if (envKey) apiKey = envKey;
  }

  if (!apiKey) {
    throw new Error("Cal.com não conectado para esta empresa. Vá em Configurações → Integrações → Cal.com.");
  }

  const creds: CompanyCalcomCreds = {
    apiKey,
    bookingLink: company?.calcom_booking_link || Deno.env.get("CALCOM_BOOKING_LINK") || null,
    webhookSecret: company?.calcom_webhook_secret || Deno.env.get("CALCOM_WEBHOOK_SECRET") || null,
    defaultEventTypeId: company?.calcom_default_event_type_id ?? null,
    companySlug: company?.slug ?? null,
    source,
  };
  _credsCache.set(companyId, creds);
  return creds;
}

/** Same as above but returns null instead of throwing when unavailable. */
export async function tryGetCompanyCalcomCreds(
  supabase: any,
  companyId: string,
): Promise<CompanyCalcomCreds | null> {
  try { return await getCompanyCalcomCreds(supabase, companyId); }
  catch (e) { console.warn("tryGetCompanyCalcomCreds:", (e as any)?.message); return null; }
}

/** Persist or update booking row from Cal.com payload */
export async function upsertBookingFromCalcom(
  supabase: any,
  payload: any,
  opts: { company_id?: string; lead_id?: string | null; conversation_id?: string | null } = {}
) {
  const uid = payload.uid || payload.bookingUid;
  const id = payload.id || payload.bookingId;
  if (!uid && !id) return null;

  const startTime = payload.startTime || payload.start;
  const endTime = payload.endTime || payload.end;
  const attendees = payload.attendees || [];
  const meetingUrl = payload.meetingUrl || payload.metadata?.videoCallUrl || null;

  const row: any = {
    calcom_booking_uid: uid,
    calcom_booking_id: id || null,
    calcom_event_type_id: payload.eventTypeId || payload.eventType?.id || null,
    scheduled_at: startTime || null,
    end_at: endTime || null,
    duration_minutes: payload.length || payload.duration || null,
    timezone: attendees[0]?.timeZone || payload.timeZone || null,
    title: payload.title || null,
    meeting_url: meetingUrl,
    location: payload.location || null,
    attendees,
    raw_payload: payload,
    updated_at: new Date().toISOString(),
  };
  if (opts.company_id) row.company_id = opts.company_id;
  if (opts.lead_id !== undefined) row.lead_id = opts.lead_id;
  if (opts.conversation_id !== undefined) row.conversation_id = opts.conversation_id;

  const { data: existing } = await supabase
    .from("bookings")
    .select("id, company_id")
    .eq("calcom_booking_uid", uid)
    .maybeSingle();

  if (existing) {
    const { data } = await supabase
      .from("bookings")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single();
    return data;
  }
  if (!row.company_id) return null;
  const { data } = await supabase
    .from("bookings")
    .insert(row)
    .select()
    .single();
  return data;
}
