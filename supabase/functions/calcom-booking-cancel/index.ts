import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, CalcomError, corsHeaders, jsonResponse, tryGetCompanyCalcomCreds } from "../_shared/calcom.ts";
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
    const { booking_uid, reason, conversation_id, lead_id } = body;
    let { idempotency_key } = body as { idempotency_key?: string };
    if (!booking_uid) return jsonResponse({ error: "booking_uid required" }, 400);

    const { data: existing } = await supabase
      .from("bookings")
      .select("id, company_id, lead_id, status, conversation_id, scheduled_at")
      .eq("calcom_booking_uid", booking_uid)
      .maybeSingle();

    if (!idempotency_key) {
      idempotency_key = await buildIdempotencyKey({
        conversation_id: conversation_id ?? existing?.conversation_id ?? null,
        lead_id: lead_id ?? existing?.lead_id ?? null,
        action_type: "cancel",
        provider_booking_uid: booking_uid,
      });
    }

    const claim = await claimCalendarAction(supabase, {
      idempotency_key,
      conversation_id: conversation_id ?? existing?.conversation_id ?? null,
      lead_id: lead_id ?? existing?.lead_id ?? null,
      company_id: existing?.company_id ?? null,
      action_type: "cancel",
      provider_booking_uid: booking_uid,
      request_payload: { booking_uid, cancellationReason: reason || "Cliente cancelou" },
    });
    if (claim.kind === "existing") {
      return jsonResponse({
        success: true,
        idempotent_replay: true,
        already_cancelled: true,
        idempotency_key,
      });
    }
    if (claim.kind === "pending") {
      return jsonResponse({ success: false, in_flight: true, error_code: "in_flight", idempotency_key }, 409);
    }

    try {
      let alreadyCancelled = false;
      const companyCreds = existing?.company_id ? await tryGetCompanyCalcomCreds(supabase, existing.company_id) : null;
      try {
        await calcomFetch(`/v2/bookings/${booking_uid}/cancel`, {
          method: "POST",
          body: JSON.stringify({ cancellationReason: reason || "Cliente cancelou" }),
          apiKey: companyCreds?.apiKey,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/cancelled already|already.*cancelled|has been cancelled/i.test(msg)) {
          alreadyCancelled = true;
          console.log(`calcom-booking-cancel: booking ${booking_uid} already cancelled, syncing DB.`);
        } else {
          throw err;
        }
      }

      if (existing) {
        if (existing.status !== "cancelled") {
          await supabase.from("bookings").update({ status: "cancelled", cancel_reason: reason || null }).eq("id", existing.id);
        }
        if (existing.company_id && !alreadyCancelled) {
          await supabase.from("lead_activities").insert({
            company_id: existing.company_id,
            lead_id: existing.lead_id,
            type: "meeting",
            description: `❌ Reunião cancelada${reason ? `: ${reason}` : ""}`,
            metadata: { booking_uid, reason, idempotency_key },
          });
        }
        // Liberar slot_holds (±5min) associados a esse horário pro mesmo lead.
        try {
          if (existing.lead_id && existing.scheduled_at) {
            const target = new Date(existing.scheduled_at).getTime();
            const lo = new Date(target - 5 * 60_000).toISOString();
            const hi = new Date(target + 5 * 60_000).toISOString();
            const { data: relatedHolds } = await supabase
              .from("slot_holds")
              .select("id")
              .eq("lead_id", existing.lead_id)
              .in("status", ["held", "confirmed"])
              .gte("slot_datetime", lo)
              .lte("slot_datetime", hi);
            if (relatedHolds && relatedHolds.length > 0) {
              await supabase.from("slot_holds")
                .update({ status: "released" })
                .in("id", relatedHolds.map((h: any) => h.id));
            }
          }
        } catch (e) {
          console.error("calcom-booking-cancel: release slot_holds failed:", e);
        }
      }

      await markCalendarActionOk(supabase, claim.row.id, {
        provider_booking_uid: booking_uid,
        response_payload: { already_cancelled: alreadyCancelled },
      });

      return jsonResponse({ success: true, already_cancelled: alreadyCancelled, idempotency_key });
    } catch (err) {
      const calStatus = err instanceof CalcomError ? err.status : null;
      const calBody = err instanceof CalcomError ? err.body : null;
      const calMessage = err instanceof Error ? err.message : String(err);
      const failurePayload = {
        cal_status: calStatus,
        cal_body: calBody,
        cal_message: calMessage,
        booking_uid,
      };
      console.error("calcom-booking-cancel: cal.com rejected", JSON.stringify(failurePayload));
      try {
        await markCalendarActionFailed(supabase, claim.row.id, err);
        await supabase
          .from("calendar_actions")
          .update({ response_payload: failurePayload })
          .eq("id", claim.row.id);
      } catch (_) { /* swallow */ }
      const httpStatus = calStatus && calStatus >= 400 && calStatus < 600 ? 502 : 500;
      return jsonResponse(
        {
          success: false,
          error: calMessage,
          cal_status: calStatus,
          cal_body: calBody,
          idempotency_key,
        },
        httpStatus,
      );
    }
  } catch (e) {
    console.error("calcom-booking-cancel error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
