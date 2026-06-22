import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse, upsertBookingFromCalcom } from "../_shared/calcom.ts";
import { insertBookingSystemMessage, type BookingEventType } from "../_shared/booking-messages.ts";

async function verifySignature(secret: string, signature: string | null, rawBody: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
    const provided = signature.replace(/^sha256=/, "").toLowerCase();
    return hex === provided;
  } catch {
    return false;
  }
}

// SDR-initiated bookings use a placeholder attendee email of the form
// `noreply+<lead_uuid>@<domain>` when the lead has no real email. Extract the
// UUID so we can link the booking back to its lead even when the webhook
// arrives before/without an explicit linkage in the bookings row.
function extractLeadIdFromPlaceholder(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = String(email).toLowerCase().match(/^noreply\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/);
  return m ? m[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rawBody = await req.text();
  const signature = req.headers.get("x-cal-signature-256") || req.headers.get("X-Cal-Signature-256");
  const secret = Deno.env.get("CALCOM_WEBHOOK_SECRET") || "";
  const sigValid = secret ? await verifySignature(secret, signature, rawBody) : false;

  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch { return jsonResponse({ error: "invalid json" }, 400); }

  const eventType = payload.triggerEvent || payload.type || "unknown";
  const bookingPayload = payload.payload || payload;
  const bookingUid = bookingPayload.uid || bookingPayload.bookingUid;
  const attendeeEmail = bookingPayload.attendees?.[0]?.email;

  // Identify company/lead
  let company_id: string | undefined;
  let lead_id: string | undefined;
  if (bookingUid) {
    const { data: existing } = await supabase.from("bookings").select("company_id, lead_id").eq("calcom_booking_uid", bookingUid).maybeSingle();
    company_id = existing?.company_id;
    lead_id = existing?.lead_id;
  }
  if (!company_id && attendeeEmail) {
    const { data: lead } = await supabase.from("leads").select("id, company_id").eq("email", attendeeEmail).limit(1).maybeSingle();
    if (lead) { company_id = lead.company_id; lead_id = lead.id; }
  }
  // Fallback: SDR placeholder email `noreply+<lead_id>@...` → resolve lead via UUID.
  if (!company_id) {
    const placeholderLeadId = extractLeadIdFromPlaceholder(attendeeEmail);
    if (placeholderLeadId) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, company_id")
        .eq("id", placeholderLeadId)
        .maybeSingle();
      if (lead) {
        company_id = lead.company_id;
        lead_id = lead.id;
        // Re-link the existing booking row (if any) so future events stay linked.
        if (bookingUid) {
          await supabase
            .from("bookings")
            .update({ company_id, lead_id })
            .eq("calcom_booking_uid", bookingUid)
            .is("lead_id", null);
        }
      }
    }
  }

  // Log webhook
  const { data: logRow } = await supabase.from("calcom_webhook_log").insert({
    company_id: company_id || null,
    event_type: eventType,
    booking_uid: bookingUid || null,
    payload,
    signature_valid: sigValid,
  }).select("id").single();

  if (secret && !sigValid) {
    await supabase.from("calcom_webhook_log").update({ error: "invalid signature" }).eq("id", logRow!.id);
    return jsonResponse({ error: "invalid signature" }, 401);
  }

  try {
    // ── Phase 5: reconciliation mode ────────────────────────────────
    // Try to locate a calendar_actions row that originated this booking. If
    // present, this webhook is just an echo of an SDR-initiated action — we
    // mark it reconciled and do NOT send any new outbound to the lead
    // (the agent already confirmed synchronously in the tool loop).
    // Orphan events (no calendar_actions) are treated as bookings created
    // directly via the public Cal.com link and recorded with source='webhook'.
    let originatingAction: { id: string; action_type: string } | null = null;
    if (bookingUid) {
      const { data: action } = await supabase
        .from("calendar_actions")
        .select("id, action_type")
        .eq("provider_booking_uid", bookingUid)
        .eq("status", "ok")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      originatingAction = action ?? null;
    }
    const isOrphan = !originatingAction;

    // Capture previous scheduled_at BEFORE upsert (for reschedule events)
    let previousScheduledAt: string | null = null;
    if (bookingUid) {
      const { data: prev } = await supabase
        .from("bookings")
        .select("scheduled_at")
        .eq("calcom_booking_uid", bookingUid)
        .maybeSingle();
      previousScheduledAt = prev?.scheduled_at || null;
    }

    const booking = await upsertBookingFromCalcom(supabase, bookingPayload, { company_id, lead_id });

    // Update status + source based on event type and whether it's orphan.
    if (booking) {
      let newStatus: string | null = null;
      switch (eventType) {
        case "BOOKING_CREATED": newStatus = "confirmed"; break;
        case "BOOKING_RESCHEDULED": newStatus = "rescheduled"; break;
        case "BOOKING_CANCELLED": newStatus = "cancelled"; break;
        case "BOOKING_NO_SHOW_UPDATED": newStatus = "no_show"; break;
        case "MEETING_ENDED": newStatus = "completed"; break;
      }
      const patch: Record<string, unknown> = {};
      if (newStatus) patch.status = newStatus;
      // Stamp source only on creation (don't overwrite on later updates).
      if (eventType === "BOOKING_CREATED") {
        patch.source = isOrphan ? "webhook" : "sdr_agent";
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("bookings").update(patch).eq("id", booking.id);
      }
    }

    // Mark calendar_actions reconciled.
    if (originatingAction) {
      await supabase
        .from("calendar_actions")
        .update({ reconciled_at: new Date().toISOString() })
        .eq("id", originatingAction.id);
    }

    // Insert system message in the lead's conversation (internal audit trail).
    const eventMap: Record<string, BookingEventType> = {
      BOOKING_CREATED: "booking_created",
      BOOKING_RESCHEDULED: "booking_rescheduled",
      BOOKING_CANCELLED: "booking_cancelled",
      BOOKING_NO_SHOW_UPDATED: "booking_no_show",
      MEETING_ENDED: "booking_completed",
    };
    const mappedEvent = eventMap[eventType];
    if (mappedEvent && company_id && lead_id) {
      await insertBookingSystemMessage(supabase, {
        lead_id,
        company_id,
        event_type: mappedEvent,
        booking_uid: bookingUid || null,
        scheduled_at: booking?.scheduled_at || null,
        previous_scheduled_at: mappedEvent === "booking_rescheduled" ? previousScheduledAt : null,
      });
    }

    // Enqueue follow-up actions. For SDR-initiated events the agent already
    // handled the outbound — webhook only enqueues outbounds when the lead
    // acted directly on Cal.com.
    if (company_id && lead_id) {
      const { data: convRow } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("company_id", company_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const conversation_id = convRow?.id || null;

      const enqueue = async (action_type: string, params: any = {}, delayMinutes = 0) => {
        const scheduled_for = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        const { error: enqErr } = await supabase.from("lead_action_queue").insert({
          company_id, lead_id, conversation_id, action_type, params, status: "pending", scheduled_for, triggered_by: "calcom_webhook",
        });
        if (enqErr) {
          console.error(`calcom-webhook: failed to enqueue ${action_type}:`, enqErr.message);
          await supabase.from("calcom_webhook_log").update({
            error: `enqueue ${action_type} failed: ${enqErr.message}`,
          }).eq("id", logRow!.id);
        }
      };

      // Detect who initiated this webhook event (lead vs. organizer/SDR/app)
      const leadEmailLower = (bookingPayload.attendees?.[0]?.email || "").toLowerCase();
      const organizerEmailLower = (bookingPayload.organizer?.email || bookingPayload.user?.email || "").toLowerCase();
      const cancelledByEmail = (
        bookingPayload.cancellation?.cancelledByEmail ||
        bookingPayload.cancelledBy?.email ||
        bookingPayload.cancelledBy ||
        ""
      ).toString().toLowerCase();
      const cancelledByOrganizer =
        !!cancelledByEmail &&
        !!organizerEmailLower &&
        cancelledByEmail === organizerEmailLower;
      const cancelledByLead = !cancelledByOrganizer;

      switch (eventType) {
        case "BOOKING_CREATED":
          // SDR-initiated bookings already got a synchronous confirmation
          // from the agent loop (Phase 2B). Only orphan bookings — created
          // by the lead through the public Cal.com link — need an outbound.
          if (isOrphan) {
            await enqueue("send_booking_confirmation", { booking_uid: bookingUid });
          }
          // Lead-score update is always valid (idempotent on backend).
          await enqueue("update_lead_score", { delta: 30, reason: "meeting_booked" });
          break;
        case "BOOKING_RESCHEDULED":
          // No outbound: SDR loop already confirmed, or lead saw confirmation
          // on Cal.com when rescheduling themselves.
          break;
        case "BOOKING_CANCELLED": {
          if (!cancelledByLead) {
            console.log(`calcom-webhook: cancellation initiated by organizer (${cancelledByEmail}), skipping follow-up.`);
            break;
          }
          // Internal-stamp check (5min window) — eco of our own cancel.
          if (bookingUid) {
            const { data: bk } = await supabase
              .from("bookings")
              .select("cancellation_source, cancellation_requested_at")
              .eq("calcom_booking_uid", bookingUid)
              .maybeSingle();
            const stampedAt = bk?.cancellation_requested_at ? new Date(bk.cancellation_requested_at).getTime() : 0;
            const recentlyStamped = stampedAt > 0 && Date.now() - stampedAt < 5 * 60_000;
            if (recentlyStamped && bk?.cancellation_source && bk.cancellation_source !== "lead") {
              console.log(`calcom-webhook: cancellation initiated internally (${bk.cancellation_source}), skipping acknowledge.`);
              break;
            }
          }
          // Idempotency: skip if already enqueued for this booking in the last 24h.
          const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
          const { data: existing } = await supabase
            .from("lead_action_queue")
            .select("id")
            .eq("company_id", company_id)
            .eq("lead_id", lead_id)
            .eq("action_type", "acknowledge_cancellation")
            .gte("created_at", since)
            .filter("params->>booking_uid", "eq", bookingUid || "")
            .in("status", ["pending", "done"])
            .limit(1)
            .maybeSingle();
          if (existing) {
            console.log(`calcom-webhook: acknowledge_cancellation already enqueued for booking ${bookingUid}, skipping.`);
            break;
          }
          await enqueue("acknowledge_cancellation", { booking_uid: bookingUid });
          break;
        }
        case "BOOKING_NO_SHOW_UPDATED":
          await enqueue("recover_no_show", { booking_uid: bookingUid }, 60);
          break;
        case "MEETING_ENDED":
          await enqueue("send_meeting_recap", { booking_uid: bookingUid }, 5);
          await enqueue("request_feedback", { booking_uid: bookingUid }, 60 * 24);
          break;
      }
    }


    await supabase.from("calcom_webhook_log").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", logRow!.id);
    return jsonResponse({ success: true });
  } catch (e: any) {
    console.error("calcom-webhook process error:", e);
    await supabase.from("calcom_webhook_log").update({ error: e?.message || String(e) }).eq("id", logRow!.id);
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
