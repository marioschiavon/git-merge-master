import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { insertBookingSystemMessage } from "../_shared/booking-messages.ts";
import { cancelCalcomReservation, upsertBookingFromCalcom } from "../_shared/calcom.ts";
import { formatBRTLong } from "../_shared/datetime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALCOM_BOOKINGS_API_VERSION = "2024-08-13";
const CALCOM_SLOTS_API_VERSION = "2024-09-04";
const CALCOM_EVENT_TYPES_API_VERSION = "2024-06-14";

async function resolveEventTypeId(apiKey: string): Promise<number> {
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) return Number(manualId);

  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch event types: ${res.status}`);
  const json = await res.json();
  const eventTypes = json.data?.eventTypes || json.data || [];
  if (!eventTypes.length) throw new Error("No event types found");
  return eventTypes[0].id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    if (!CALCOM_API_KEY) throw new Error("CALCOM_API_KEY not configured");

    const body = await req.json();
    const { lead_id, selected_slot_hold_id, force_placeholder, guest_emails } = body;

    if (!lead_id || !selected_slot_hold_id) {
      return new Response(JSON.stringify({ error: "lead_id and selected_slot_hold_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all held slots for this lead
    const { data: holds, error: holdsError } = await supabase
      .from("slot_holds")
      .select("*")
      .eq("lead_id", lead_id)
      .eq("status", "held")
      .order("slot_datetime", { ascending: true });

    if (holdsError) throw holdsError;
    if (!holds || holds.length === 0) {
      return new Response(JSON.stringify({ error: "No held slots found for this lead" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selectedHold = holds.find((h: any) => h.id === selected_slot_hold_id);
    if (!selectedHold) {
      return new Response(JSON.stringify({ error: "Selected slot hold not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const otherHolds = holds.filter((h: any) => h.id !== selected_slot_hold_id);

    // Get lead info for booking
    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, company_name")
      .eq("id", lead_id)
      .single();

    let usedPlaceholderEmail = false;
    let attendeeEmail = lead?.email as string | undefined;

    if (!attendeeEmail) {
      if (force_placeholder) {
        const senderDomain = Deno.env.get("SENDER_DOMAIN") || "lovable.app";
        attendeeEmail = `noreply+${lead_id}@${senderDomain}`;
        usedPlaceholderEmail = true;
        console.log(`Using placeholder email for booking: ${attendeeEmail}`);
      } else {
        return new Response(JSON.stringify({ error: "Lead email is required for booking" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Resolve event type ID
    const eventTypeId = await resolveEventTypeId(CALCOM_API_KEY);

    // Create definitive booking on Cal.com
    console.log("Creating booking for slot:", selectedHold.slot_datetime);
    // Merge guests provided by the agent with any guests previously stashed
    // on the slot_hold metadata (lead may have mentioned them before book).
    const holdMetaGuests = Array.isArray((selectedHold as any)?.metadata?.guest_emails)
      ? (selectedHold as any).metadata.guest_emails as string[] : [];
    const mergedGuests = Array.from(new Set(
      [...holdMetaGuests, ...(Array.isArray(guest_emails) ? guest_emails : [])]
        .map((g) => String(g || "").trim().toLowerCase())
        .filter((g) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g) && g !== String(attendeeEmail).toLowerCase()),
    ));
    const bookingRes = await fetch("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALCOM_API_KEY}`,
        "cal-api-version": CALCOM_BOOKINGS_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventTypeId,
        start: selectedHold.slot_datetime,
        attendee: {
          name: lead?.name || "Lead",
          email: attendeeEmail,
          timeZone: "America/Sao_Paulo",
          language: "pt",
        },
        ...(mergedGuests.length > 0 ? { guests: mergedGuests } : {}),
      }),
    });

    let bookingData: any = null;
    if (bookingRes.ok) {
      bookingData = await bookingRes.json();
      console.log("Booking created successfully:", bookingData.data?.uid || bookingData.data?.id);
    } else {
      const errText = await bookingRes.text();
      console.error("Failed to create booking:", errText);
      throw new Error(`Cal.com booking failed: ${bookingRes.status} - ${errText}`);
    }

    // Cancel other slot reservations
    for (const hold of otherHolds) {
      if (hold.cal_booking_uid) {
        await cancelCalcomReservation(hold.cal_booking_uid);
      }

      // Update hold status to cancelled
      await supabase
        .from("slot_holds")
        .update({ status: "cancelled" })
        .eq("id", hold.id);
    }

    // Update selected hold to confirmed
    await supabase
      .from("slot_holds")
      .update({
        status: "confirmed",
        cal_booking_uid: bookingData?.data?.uid || bookingData?.data?.id || selectedHold.cal_booking_uid,
      })
      .eq("id", selectedHold.id);

    // Update enrollment if exists — try from slot_holds first, then find by lead_id
    let enrollmentId = selectedHold.enrollment_id;
    if (!enrollmentId) {
      // Find active/paused enrollment for this lead
      const { data: activeEnrollment } = await supabase
        .from("cadence_enrollments")
        .select("id")
        .eq("lead_id", lead_id)
        .in("status", ["active", "paused"])
        .order("enrolled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      enrollmentId = activeEnrollment?.id;
    }

    if (enrollmentId) {
      const { error: enrollError } = await supabase
        .from("cadence_enrollments")
        .update({
          status: "completed",
          meeting_scheduled: true,
          completed_at: new Date().toISOString(),
        })
        .eq("id", enrollmentId);
      
      if (enrollError) {
        console.error("Failed to update enrollment:", enrollError);
      } else {
        console.log(`Enrollment ${enrollmentId} marked as completed with meeting_scheduled=true`);
      }
    }

    // Log activity
    if (selectedHold.company_id) {
      const formattedDate = formatBRTLong(selectedHold.slot_datetime);

      await supabase.from("lead_activities").insert({
        company_id: selectedHold.company_id,
        lead_id: lead_id,
        type: "meeting",
        description: `✅ Reunião confirmada para ${formattedDate}`,
        metadata: {
          cal_booking_uid: bookingData?.data?.uid || bookingData?.data?.id,
          slot_datetime: selectedHold.slot_datetime,
          confirmed_at: new Date().toISOString(),
        },
      });

      if (usedPlaceholderEmail) {
        await supabase.from("lead_activities").insert({
          company_id: selectedHold.company_id,
          lead_id: lead_id,
          type: "alert",
          description: `⚠️ Reunião confirmada sem e-mail real do lead — enviar convite manualmente para ${formattedDate}`,
          metadata: {
            placeholder_email: attendeeEmail,
            cal_booking_uid: bookingData?.data?.uid || bookingData?.data?.id,
            slot_datetime: selectedHold.slot_datetime,
          },
        });
      }

      // Insert system message in conversation for immediate UI feedback
      await insertBookingSystemMessage(supabase, {
        lead_id,
        company_id: selectedHold.company_id,
        event_type: "booking_created",
        booking_uid: bookingData?.data?.uid || bookingData?.data?.id || null,
        scheduled_at: selectedHold.slot_datetime,
      });
    }

    // Clear any pending email request flag now that booking is confirmed
    await supabase
      .from("leads")
      .update({ pending_email_slot_hold_id: null })
      .eq("id", lead_id);

    const finalBookingUid =
      bookingData?.data?.uid || bookingData?.data?.id || null;
    return new Response(JSON.stringify({
      success: true,
      booking: bookingData?.data,
      booking_uid: finalBookingUid,
      calcom_booking_uid: finalBookingUid,
      confirmed_slot: selectedHold.slot_datetime,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("calcom-confirm-booking error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
