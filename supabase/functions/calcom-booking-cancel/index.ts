import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, CalcomError, corsHeaders, jsonResponse } from "../_shared/calcom.ts";
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
      .select("id, company_id, lead_id, status, conversation_id")
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
      return jsonResponse({ success: false, in_flight: true, idempotency_key }, 409);
    }

    try {
      let alreadyCancelled = false;
      try {
        await calcomFetch(`/v2/bookings/${booking_uid}/cancel`, {
          method: "POST",
          body: JSON.stringify({ cancellationReason: reason || "Cliente cancelou" }),
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
      }

      await markCalendarActionOk(supabase, claim.row.id, {
        provider_booking_uid: booking_uid,
        response_payload: { already_cancelled: alreadyCancelled },
      });

      return jsonResponse({ success: true, already_cancelled: alreadyCancelled, idempotency_key });
    } catch (err) {
      await markCalendarActionFailed(supabase, claim.row.id, err);
      throw err;
    }
  } catch (e) {
    console.error("calcom-booking-cancel error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
