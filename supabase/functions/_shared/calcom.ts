// Shared Cal.com helpers
export const CALCOM_BOOKINGS_API_VERSION = "2024-08-13";
export const CALCOM_EVENT_TYPES_API_VERSION = "2024-06-14";
export const CALCOM_SLOTS_API_VERSION = "2024-09-04";

export function calcomHeaders(apiKey: string, version = CALCOM_BOOKINGS_API_VERSION) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

export async function calcomFetch(
  path: string,
  init: RequestInit & { version?: string } = {}
) {
  const apiKey = Deno.env.get("CALCOM_API_KEY");
  if (!apiKey) throw new Error("CALCOM_API_KEY not configured");
  const { version, headers, ...rest } = init as any;
  const res = await fetch(`https://api.cal.com${path}`, {
    ...rest,
    headers: { ...calcomHeaders(apiKey, version), ...(headers || {}) },
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Cal.com ${path} ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

/** Cancel a confirmed Cal.com booking (POST /v2/bookings/{uid}/cancel) */
export async function cancelCalcomBooking(
  uid: string,
  reason = "Cancelado pelo prospect via conversa"
): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  const apiKey = Deno.env.get("CALCOM_API_KEY");
  if (!apiKey) return { ok: false, status: 0, body: null, error: "CALCOM_API_KEY not configured" };
  try {
    const res = await fetch(`https://api.cal.com/v2/bookings/${uid}/cancel`, {
      method: "POST",
      headers: calcomHeaders(apiKey, CALCOM_BOOKINGS_API_VERSION),
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
  uid: string
): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  const apiKey = Deno.env.get("CALCOM_API_KEY");
  if (!apiKey) return { ok: false, status: 0, body: null, error: "CALCOM_API_KEY not configured" };
  try {
    const res = await fetch(`https://api.cal.com/v2/slots/reservations/${uid}`, {
      method: "DELETE",
      headers: calcomHeaders(apiKey, CALCOM_SLOTS_API_VERSION),
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

/** Resolve the default Cal.com event type id (uses CALCOM_EVENT_TYPE_ID secret if set, otherwise first event type). */
export async function resolveEventTypeId(apiKey: string): Promise<number> {
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) {
    return Number(manualId);
  }
  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch event types from Cal.com: ${res.status}`);
  }
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
