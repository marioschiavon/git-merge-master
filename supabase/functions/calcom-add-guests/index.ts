// Adds guests to an existing Cal.com booking using the native endpoint
// POST /v2/bookings/{uid}/guests — no cancel/recreate dance required.
// Cal.com updates the connected Google Calendar event and sends e-mails
// to the new guests automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  CALCOM_BOOKINGS_API_VERSION,
  calcomFetch,
  corsHeaders,
  jsonResponse,
} from "../_shared/calcom.ts";
import {
  claimCalendarAction,
  markCalendarActionFailed,
  markCalendarActionOk,
} from "../_shared/idempotency.ts";

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const booking_uid: string | undefined = body?.booking_uid;
    const rawGuests: unknown = body?.guests;
    const lead_id: string | null = body?.lead_id ?? null;
    const conversation_id: string | null = body?.conversation_id ?? null;
    const timezone: string | undefined = body?.timezone;

    if (!booking_uid) return jsonResponse({ error: "booking_uid required" }, 400);
    if (!Array.isArray(rawGuests) || rawGuests.length === 0) {
      return jsonResponse({ error: "guests (string[]) required" }, 400);
    }

    // Load the booking to find the lead email (to remove from guests list)
    const { data: bookingRow } = await supabase
      .from("bookings")
      .select("id, company_id, lead_id, attendees, raw_payload, calcom_booking_uid, conversation_id")
      .eq("calcom_booking_uid", booking_uid)
      .maybeSingle();

    if (!bookingRow) return jsonResponse({ error: "booking not found" }, 404);

    // Resolve lead email (to dedupe against guests)
    let leadEmail = "";
    if (bookingRow.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("email")
        .eq("id", bookingRow.lead_id)
        .maybeSingle();
      leadEmail = String(lead?.email || "").toLowerCase();
    }

    const existingAttendeeEmails = Array.isArray(bookingRow.attendees)
      ? (bookingRow.attendees as any[])
          .map((a) => String(a?.email || "").toLowerCase())
          .filter(Boolean)
      : [];
    const existingGuests = Array.isArray((bookingRow.raw_payload as any)?.guest_emails)
      ? ((bookingRow.raw_payload as any).guest_emails as string[]).map((g) =>
          String(g || "").toLowerCase(),
        )
      : existingAttendeeEmails.filter((e) => e && e !== leadEmail);

    // Sanitize incoming list
    const sanitized = Array.from(
      new Set(
        (rawGuests as unknown[])
          .map((g) => String(g || "").trim().toLowerCase())
          .filter((g) => EMAIL_RE.test(g) && g !== leadEmail),
      ),
    );

    // Only the ones that aren't on the booking already
    const newGuests = sanitized.filter(
      (g) => !existingGuests.includes(g) && !existingAttendeeEmails.includes(g),
    );

    if (newGuests.length === 0) {
      return jsonResponse({
        success: true,
        skipped: "all_guests_already_present",
        booking_uid,
        guest_emails: existingGuests,
      });
    }

    // Idempotency key — stable for the same (booking, sorted new guests) tuple.
    // This makes safe retries replay instead of double-adding.
    const sortedKey = [...newGuests].sort().join(",");
    const keyRaw = `add_guests|${booking_uid}|${sortedKey}`;
    const keyBytes = new TextEncoder().encode(keyRaw);
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const claim = await claimCalendarAction(supabase, {
      idempotency_key: keyHash,
      conversation_id: conversation_id ?? bookingRow.conversation_id ?? null,
      lead_id: lead_id ?? bookingRow.lead_id ?? null,
      company_id: bookingRow.company_id ?? null,
      action_type: "add_guests",
      provider_booking_uid: booking_uid,
      request_payload: { guests: newGuests, booking_uid },
    });

    if (claim.kind === "existing") {
      return jsonResponse({
        success: true,
        idempotent_replay: true,
        booking_uid,
        added_guests: newGuests,
      });
    }
    if (claim.kind === "pending") {
      return jsonResponse(
        { success: false, in_flight: true, error: "Another add_guests is in flight" },
        409,
      );
    }

    // Build the Cal.com payload
    const guestsPayload = newGuests.map((email) => {
      const namePart = email.split("@")[0].replace(/[._-]+/g, " ").trim();
      return {
        email,
        name: namePart.length ? namePart.replace(/\b\w/g, (c) => c.toUpperCase()) : email,
        ...(timezone ? { timeZone: timezone } : {}),
      };
    });

    try {
      const result = await calcomFetch(`/v2/bookings/${booking_uid}/guests`, {
        method: "POST",
        version: CALCOM_BOOKINGS_API_VERSION,
        body: JSON.stringify({ guests: guestsPayload }),
      });

      const updated = (result as any)?.data ?? result;

      // Merge guest_emails canonical list
      const mergedGuests = Array.from(new Set([...existingGuests, ...newGuests]));
      const mergedAttendees = Array.isArray(updated?.attendees) && updated.attendees.length > 0
        ? updated.attendees
        : bookingRow.attendees;
      const mergedRaw = {
        ...((bookingRow.raw_payload as object) || {}),
        guest_emails: mergedGuests,
      };

      await supabase
        .from("bookings")
        .update({ raw_payload: mergedRaw, attendees: mergedAttendees })
        .eq("id", bookingRow.id);

      if (bookingRow.company_id) {
        await supabase.from("lead_activities").insert({
          company_id: bookingRow.company_id,
          lead_id: bookingRow.lead_id ?? null,
          type: "meeting",
          description: `👥 Convidado(s) adicionado(s) à reunião: ${newGuests.join(", ")}`,
          metadata: { booking_uid, added_guests: newGuests, total_guests: mergedGuests },
        });
      }

      await markCalendarActionOk(supabase, claim.row.id, {
        provider_booking_uid: booking_uid,
        response_payload: updated ?? {},
      });

      return jsonResponse({
        success: true,
        booking_uid,
        added_guests: newGuests,
        total_guests: mergedGuests,
      });
    } catch (err) {
      await markCalendarActionFailed(supabase, claim.row.id, err);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[calcom-add-guests] failed:", msg);
      return jsonResponse({ error: msg }, 502);
    }
  } catch (e) {
    console.error("calcom-add-guests error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
