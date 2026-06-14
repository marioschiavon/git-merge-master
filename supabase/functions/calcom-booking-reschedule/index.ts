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
    const { booking_uid, start, reason, lead_id, conversation_id } = body;
    let { idempotency_key } = body as { idempotency_key?: string };
    if (!booking_uid || !start) return jsonResponse({ error: "booking_uid and start required" }, 400);

    const { data: prev } = await supabase
      .from("bookings")
      .select("id, company_id, lead_id, conversation_id")
      .eq("calcom_booking_uid", booking_uid)
      .maybeSingle();

    if (!idempotency_key) {
      idempotency_key = await buildIdempotencyKey({
        conversation_id: conversation_id ?? prev?.conversation_id ?? null,
        lead_id: lead_id ?? prev?.lead_id ?? null,
        action_type: "reschedule",
        requested_start: start,
        provider_booking_uid: booking_uid,
      });
    }

    const requestPayload = { booking_uid, start, reschedulingReason: reason || "Cliente solicitou remarcação" };
    const claim = await claimCalendarAction(supabase, {
      idempotency_key,
      conversation_id: conversation_id ?? prev?.conversation_id ?? null,
      lead_id: lead_id ?? prev?.lead_id ?? null,
      company_id: prev?.company_id ?? null,
      action_type: "reschedule",
      requested_start: start,
      provider_booking_uid: booking_uid,
      request_payload: requestPayload,
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
      return jsonResponse({ success: false, in_flight: true, idempotency_key }, 409);
    }

    try {
      const result = await calcomFetch(`/v2/bookings/${booking_uid}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ start, reschedulingReason: reason || "Cliente solicitou remarcação" }),
      });
      const data = result.data || result;

      if (prev) {
        await supabase.from("bookings").update({ status: "rescheduled", reschedule_reason: reason || null }).eq("id", prev.id);
      }

      const newBooking = await upsertBookingFromCalcom(supabase, data, {
        company_id: prev?.company_id,
        lead_id: prev?.lead_id || lead_id || null,
        conversation_id: prev?.conversation_id || null,
      });
      if (newBooking) {
        await supabase
          .from("bookings")
          .update({ status: "confirmed", previous_booking_id: prev?.id || null, reschedule_reason: reason || null })
          .eq("id", newBooking.id);
      }

      if (prev?.company_id) {
        await supabase.from("lead_activities").insert({
          company_id: prev.company_id,
          lead_id: prev.lead_id,
          type: "meeting",
          description: `🔄 Reunião remarcada para ${new Date(start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
          metadata: { previous_uid: booking_uid, new_uid: data.uid, reason, idempotency_key },
        });
      }

      await markCalendarActionOk(supabase, claim.row.id, {
        provider_booking_uid: data?.uid ?? booking_uid,
        response_payload: data ?? {},
      });

      return jsonResponse({ success: true, booking: data, idempotency_key });
    } catch (err) {
      await markCalendarActionFailed(supabase, claim.row.id, err);
      throw err;
    }
  } catch (e) {
    console.error("calcom-booking-reschedule error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
