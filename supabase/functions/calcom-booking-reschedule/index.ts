import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { CalcomError, calcomFetch, corsHeaders, jsonResponse, upsertBookingFromCalcom, tryGetCompanyCalcomCreds } from "../_shared/calcom.ts";
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
      // Stale-claim recovery: if the pending claim is older than 60s, the previous
      // attempt almost certainly crashed before marking ok/failed. Reset it.
      const ageMs = Date.now() - new Date((claim.row as any).updated_at ?? (claim.row as any).created_at ?? Date.now()).getTime();
      if (ageMs > 60_000) {
        await supabase.from("calendar_actions").update({ status: "failed", error_message: "stale_pending_reset" }).eq("id", claim.row.id);
        // Retry by recursing (simpler than threading the claim through).
        return await (async () => {
          const r = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) });
          const text = await r.text();
          return new Response(text, { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        })();
      }
      // Distinct from upstream 409; use 425 (Too Early) so logs don't collide.
      return jsonResponse({ success: false, in_flight: true, idempotency_key }, 425);
    }

    // ── Pre-flight: validate booking still exists on Cal.com ──────────
    // If the uid is unknown or already cancelled, mark locally and signal the
    // caller to fall back to book_slot. Avoids 4xx loops from stale UIDs.
    const companyCreds = prev?.company_id ? await tryGetCompanyCalcomCreds(supabase, prev.company_id) : null;
    try {
      const fresh = await calcomFetch(`/v2/bookings/${booking_uid}`, { apiKey: companyCreds?.apiKey });
      const freshData = fresh?.data ?? fresh;
      const status = String(freshData?.status ?? "").toLowerCase();
      if (status === "cancelled" || status === "rejected") {
        if (prev) {
          await supabase.from("bookings").update({ status: "cancelled" }).eq("id", prev.id);
        }
        await markCalendarActionFailed(supabase, claim.row.id, "booking_not_found_or_cancelled", {
          calcom_status: 200,
          calcom_body: { status },
        });
        return jsonResponse({
          success: false,
          error: "booking_not_found",
          error_code: "booking_not_found",
          calcom_status: 200,
          calcom_body: { status },
          suggested_message: "Vi que a reunião anterior já não está ativa — vou criar um novo agendamento.",
        }, 410);
      }
    } catch (e) {
      if (e instanceof CalcomError && e.status === 404) {
        if (prev) {
          await supabase.from("bookings").update({ status: "cancelled" }).eq("id", prev.id);
        }
        await markCalendarActionFailed(supabase, claim.row.id, "booking_not_found", {
          calcom_status: 404,
          calcom_body: e.body,
        });
        return jsonResponse({
          success: false,
          error: "booking_not_found",
          error_code: "booking_not_found",
          calcom_status: 404,
          calcom_body: e.body,
          suggested_message: "Vi que a reunião anterior já não está ativa — vou criar um novo agendamento.",
        }, 410);
      }
      // Non-404 GET errors: continue and let the reschedule POST surface the real error below.
      console.warn("[calcom-booking-reschedule] pre-flight GET failed:", (e as Error)?.message);
    }

    // Estampar origem do cancelamento implícito no booking antigo ANTES de
    // chamar Cal.com — assim o webhook BOOKING_CANCELLED detecta que foi o
    // SDR quem reagendou e suprime o acknowledge_cancellation redundante.
    if (prev) {
      try {
        await supabase
          .from("bookings")
          .update({
            cancellation_source: "sdr_reschedule",
            cancellation_requested_at: new Date().toISOString(),
          })
          .eq("id", prev.id);
      } catch (_) { /* best effort */ }
    }

    try {
      const result = await calcomFetch(`/v2/bookings/${booking_uid}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ start, reschedulingReason: reason || "Cliente solicitou remarcação" }),
        apiKey: companyCreds?.apiKey,
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
          .update({
            status: "confirmed",
            source: "sdr_agent",
            previous_booking_id: prev?.id || null,
            reschedule_reason: reason || null,
          })
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

      return jsonResponse({
        success: true,
        booking: data,
        booking_uid: data?.uid ?? booking_uid,
        calcom_booking_uid: data?.uid ?? booking_uid,
        idempotency_key,
      });
    } catch (err) {
      // Persist the actual Cal.com response so we can debug from calendar_actions.
      const calcomStatus = err instanceof CalcomError ? err.status : null;
      const calcomBody = err instanceof CalcomError ? err.body : null;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await markCalendarActionFailed(
        supabase,
        claim.row.id,
        errorMessage,
        calcomStatus !== null ? { calcom_status: calcomStatus, calcom_body: calcomBody } : {},
      );

      // Map common Cal.com error shapes to structured codes the caller can act on.
      let error_code: string | null = null;
      let suggested_message: string | null = null;
      if (calcomStatus === 404) {
        error_code = "booking_not_found";
        suggested_message = "Vi que a reunião anterior já não está ativa — vou criar um novo agendamento.";
        if (prev) await supabase.from("bookings").update({ status: "cancelled" }).eq("id", prev.id);
      } else if (calcomStatus === 409 || calcomStatus === 422) {
        const msg = String(calcomBody?.error?.message ?? calcomBody?.message ?? "").toLowerCase();
        if (msg.includes("no_available_users") || msg.includes("not available") || msg.includes("unavailable") || msg.includes("conflict")) {
          error_code = "slot_unavailable";
          suggested_message = "Esse horário acabou de ficar indisponível na agenda. Quer escolher outro dia/hora?";
        } else {
          error_code = "calcom_conflict";
          suggested_message = "Tive um problema pra confirmar esse horário. Pode escolher outro?";
        }
      }

      return jsonResponse({
        success: false,
        error: errorMessage,
        error_code,
        calcom_status: calcomStatus,
        calcom_body: calcomBody,
        suggested_message,
      }, calcomStatus && calcomStatus >= 400 && calcomStatus < 600 ? calcomStatus : 502);
    }
  } catch (e) {
    console.error("calcom-booking-reschedule error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
