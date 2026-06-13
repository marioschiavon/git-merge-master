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

    // Update status based on event type
    if (booking) {
      let newStatus: string | null = null;
      switch (eventType) {
        case "BOOKING_CREATED": newStatus = "confirmed"; break;
        case "BOOKING_RESCHEDULED": newStatus = "rescheduled"; break;
        case "BOOKING_CANCELLED": newStatus = "cancelled"; break;
        case "BOOKING_NO_SHOW_UPDATED": newStatus = "no_show"; break;
        case "MEETING_ENDED": newStatus = "completed"; break;
      }
      if (newStatus) await supabase.from("bookings").update({ status: newStatus }).eq("id", booking.id);
    }

    // Insert system message in the lead's conversation
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

    // Enqueue follow-up actions
    if (company_id && lead_id) {
      const enqueue = async (action_type: string, payload: any = {}, delayMinutes = 0) => {
        const scheduled_for = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        await supabase.from("lead_action_queue").insert({
          company_id, lead_id, action_type, payload, status: "pending", scheduled_for, source: "calcom_webhook",
        });
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
      const cancelledByLead =
        !!cancelledByEmail &&
        (cancelledByEmail === leadEmailLower ||
          (!!organizerEmailLower && cancelledByEmail !== organizerEmailLower));

      switch (eventType) {
        case "BOOKING_CREATED":
          await enqueue("send_booking_confirmation", { booking_uid: bookingUid });
          await enqueue("update_lead_score", { delta: 30, reason: "meeting_booked" });
          break;
        case "BOOKING_RESCHEDULED":
          // Intentionally no outbound: lead already saw confirmation on Cal.com.
          // System message + lead_activity above are enough.
          break;
        case "BOOKING_CANCELLED": {
          if (!cancelledByLead) {
            console.log(`calcom-webhook: cancellation not initiated by lead (cancelledBy=${cancelledByEmail || "unknown"}), skipping follow-up.`);
            break;
          }
          // Idempotency: skip if we already enqueued acknowledge_cancellation for this booking in the last 24h.
          const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
          const { data: existing } = await supabase
            .from("lead_action_queue")
            .select("id")
            .eq("company_id", company_id)
            .eq("lead_id", lead_id)
            .eq("action_type", "acknowledge_cancellation")
            .gte("created_at", since)
            .filter("payload->>booking_uid", "eq", bookingUid || "")
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
