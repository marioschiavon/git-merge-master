import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, corsHeaders, jsonResponse, upsertBookingFromCalcom } from "../_shared/calcom.ts";
import {
  buildIdempotencyKey,
  claimCalendarAction,
  markCalendarActionFailed,
  markCalendarActionOk,
} from "../_shared/idempotency.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { lead_id, conversation_id, start, event_type_id, attendee_name, attendee_email, timezone, language, notes, guests } = body;
    let { idempotency_key } = body as { idempotency_key?: string };

    if (!start) return jsonResponse({ error: "start (ISO datetime) required" }, 400);

    let lead: any = null;
    if (lead_id) {
      const { data } = await supabase.from("leads").select("id, company_id, name, email").eq("id", lead_id).single();
      lead = data;
    }

    const name = attendee_name || lead?.name;
    const email = attendee_email || lead?.email;
    if (!name || !email) return jsonResponse({ error: "attendee_name and attendee_email required" }, 400);

    let eventTypeId = event_type_id;
    if (!eventTypeId && lead?.company_id) {
      const { data: comp } = await supabase.from("companies").select("calcom_default_event_type_id").eq("id", lead.company_id).maybeSingle();
      eventTypeId = comp?.calcom_default_event_type_id;
    }
    if (!eventTypeId) {
      const envId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
      if (envId) eventTypeId = Number(envId);
    }
    if (!eventTypeId) return jsonResponse({ error: "event_type_id not resolvable" }, 400);

    // Compute / accept idempotency key and claim a calendar_actions row.
    if (!idempotency_key) {
      idempotency_key = await buildIdempotencyKey({
        conversation_id: conversation_id ?? null,
        lead_id: lead?.id ?? lead_id ?? null,
        action_type: "book",
        requested_start: start,
      });
    }

    const cleanGuests = Array.isArray(guests)
      ? Array.from(new Set(
          guests
            .map((g: unknown) => String(g || "").trim().toLowerCase())
            .filter((g) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g) && g !== String(email).toLowerCase()),
        ))
      : [];

    const calBody: Record<string, unknown> = {
      eventTypeId: Number(eventTypeId),
      start,
      attendee: { name, email, timeZone: timezone || "America/Sao_Paulo", language: language || "pt" },
      ...(cleanGuests.length > 0 ? { guests: cleanGuests } : {}),
      ...(notes ? { bookingFieldsResponses: { notes } } : {}),
    };

    const claim = await claimCalendarAction(supabase, {
      idempotency_key,
      conversation_id: conversation_id ?? null,
      lead_id: lead?.id ?? lead_id ?? null,
      company_id: lead?.company_id ?? null,
      action_type: "book",
      requested_start: start,
      request_payload: calBody,
    });

    if (claim.kind === "existing") {
      return jsonResponse({
        success: true,
        idempotent_replay: true,
        booking: claim.row.response_payload,
        booking_uid: claim.row.provider_booking_uid,
        idempotency_key,
      });
    }
    if (claim.kind === "pending") {
      return jsonResponse({
        success: false,
        in_flight: true,
        idempotency_key,
        error: "Another booking attempt is already in flight",
      }, 409);
    }

    try {
      const result = await calcomFetch("/v2/bookings", { method: "POST", body: JSON.stringify(calBody) });
      const data = result.data || result;

      const booking = await upsertBookingFromCalcom(supabase, data, {
        company_id: lead?.company_id,
        lead_id: lead?.id || null,
        conversation_id: conversation_id || null,
      });
      if (booking) {
        await supabase.from("bookings").update({ status: "confirmed" }).eq("id", booking.id);
      }

      if (lead?.company_id) {
        await supabase.from("lead_activities").insert({
          company_id: lead.company_id,
          lead_id: lead.id,
          type: "meeting",
          description: `✅ Reunião agendada para ${new Date(start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
          metadata: { booking_uid: data.uid, event_type_id: eventTypeId, idempotency_key },
        });
      }

      await markCalendarActionOk(supabase, claim.row.id, {
        provider_booking_uid: data?.uid ?? null,
        response_payload: data ?? {},
      });

      return jsonResponse({ success: true, booking: data, persisted: booking, idempotency_key });
    } catch (err) {
      await markCalendarActionFailed(supabase, claim.row.id, err);
      throw err;
    }
  } catch (e) {
    console.error("calcom-booking-create error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
