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
