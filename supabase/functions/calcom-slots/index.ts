import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALCOM_SLOTS_API_VERSION = "2024-09-04";
const CALCOM_EVENT_TYPES_API_VERSION = "2024-06-14";

async function resolveEventTypeId(apiKey: string): Promise<number> {
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) {
    console.log(`Using manually configured event type ID: ${manualId}`);
    return Number(manualId);
  }

  console.log("CALCOM_EVENT_TYPE_ID not set or non-numeric, fetching from API...");
  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Failed to fetch event types:", errText);
    throw new Error(`Failed to fetch event types from Cal.com: ${res.status}`);
  }

  const json = await res.json();
  const eventTypes = json.data?.eventTypes || json.data || [];
  if (!eventTypes.length) {
    throw new Error("No event types found in your Cal.com account");
  }

  console.log(`Auto-detected event type: ${eventTypes[0].id} (${eventTypes[0].title || eventTypes[0].slug})`);
  return eventTypes[0].id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    if (!CALCOM_API_KEY) {
      throw new Error("Cal.com secret not configured (CALCOM_API_KEY)");
    }

    const eventTypeId = await resolveEventTypeId(CALCOM_API_KEY);

    const body = await req.json();
    const { company_id, lead_id, enrollment_id, conversation_id, preferred_channel, check_datetime } = body;

    if (!company_id || !lead_id) {
      return new Response(JSON.stringify({ error: "company_id and lead_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch available slots from Cal.com v2 for the next 7 days
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const slotsUrl = new URL("https://api.cal.com/v2/slots");
    slotsUrl.searchParams.set("eventTypeId", String(eventTypeId));
    slotsUrl.searchParams.set("start", startDate.toISOString());
    slotsUrl.searchParams.set("end", endDate.toISOString());

    const slotsRes = await fetch(slotsUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CALCOM_API_KEY}`,
        "cal-api-version": CALCOM_SLOTS_API_VERSION,
      },
    });

    if (!slotsRes.ok) {
      const errText = await slotsRes.text();
      console.error("Cal.com API error:", errText);
      throw new Error(`Cal.com API error: ${slotsRes.status}`);
    }

    const slotsJson = await slotsRes.json();
    const slotsData = slotsJson.data || {};

    // If check_datetime is provided, verify availability of that specific time
    if (check_datetime) {
      const requestedTime = new Date(check_datetime).getTime();
      const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

      let matchedSlot: string | null = null;
      for (const date of Object.keys(slotsData)) {
        for (const slot of slotsData[date]) {
          const slotTime = new Date(slot.start).getTime();
          if (Math.abs(slotTime - requestedTime) <= TOLERANCE_MS) {
            matchedSlot = slot.start;
            break;
          }
        }
        if (matchedSlot) break;
      }

      if (matchedSlot) {
        // Available — reserve just this one slot
        let reservationUid = "";
        try {
          const reserveRes = await fetch("https://api.cal.com/v2/slots/reservations", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${CALCOM_API_KEY}`,
              "cal-api-version": CALCOM_SLOTS_API_VERSION,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              eventTypeId: eventTypeId,
              slotStart: matchedSlot,
              reservationDuration: 120,
            }),
          });
          if (reserveRes.ok) {
            const reserveData = await reserveRes.json();
            reservationUid = reserveData.data?.reservationUid || reserveData.data?.uid || "";
          }
        } catch (e) {
          console.error("Reserve single slot error:", e);
        }

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 2);

        const { data: insertedHolds, error: insertError } = await supabase
          .from("slot_holds")
          .insert([{
            company_id,
            lead_id,
            enrollment_id: enrollment_id || null,
            conversation_id: conversation_id || null,
            slot_datetime: matchedSlot,
            status: "held",
            expires_at: expiresAt.toISOString(),
            preferred_channel: preferred_channel || null,
            cal_booking_uid: reservationUid || null,
          }])
          .select();

        if (insertError) throw insertError;

        return new Response(JSON.stringify({
          success: true,
          available: true,
          exact_slot: matchedSlot,
          slots: insertedHolds,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        // Not available — pick 2 alternatives and return them
        const selectedSlots: { date: string; start: string }[] = [];
        const sortedDates = Object.keys(slotsData).sort();
        for (const date of sortedDates) {
          if (selectedSlots.length >= 2) break;
          const daySlots = slotsData[date];
          if (daySlots && daySlots.length > 0) {
            const midIndex = Math.min(Math.floor(daySlots.length / 2), daySlots.length - 1);
            selectedSlots.push({ date, start: daySlots[midIndex].start });
          }
        }

        // Reserve alternatives
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 2);
        const holdsToInsert = [];
        for (const s of selectedSlots) {
          let uid = "";
          try {
            const rRes = await fetch("https://api.cal.com/v2/slots/reservations", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${CALCOM_API_KEY}`,
                "cal-api-version": CALCOM_SLOTS_API_VERSION,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ eventTypeId, slotStart: s.start, reservationDuration: 120 }),
            });
            if (rRes.ok) { const d = await rRes.json(); uid = d.data?.reservationUid || d.data?.uid || ""; }
          } catch (_) { /* skip */ }
          holdsToInsert.push({
            company_id, lead_id,
            enrollment_id: enrollment_id || null,
            conversation_id: conversation_id || null,
            slot_datetime: s.start, status: "held",
            expires_at: expiresAt.toISOString(),
            preferred_channel: preferred_channel || null,
            cal_booking_uid: uid || null,
          });
        }

        if (holdsToInsert.length > 0) {
          await supabase.from("slot_holds").insert(holdsToInsert).select();
        }

        const formattedSlots = selectedSlots.map(s => {
          const dt = new Date(s.start);
          return dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
            + " às " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        });

        return new Response(JSON.stringify({
          success: true,
          available: false,
          requested: check_datetime,
          formatted: formattedSlots,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Normal flow: Pick 2 slots on different days
    const selectedSlots: { date: string; start: string }[] = [];
    const sortedDates = Object.keys(slotsData).sort();

    for (const date of sortedDates) {
      if (selectedSlots.length >= 2) break;
      const daySlots = slotsData[date];
      if (daySlots && daySlots.length > 0) {
        const midIndex = Math.min(Math.floor(daySlots.length / 2), daySlots.length - 1);
        selectedSlots.push({ date, start: daySlots[midIndex].start });
      }
    }

    if (selectedSlots.length < 2) {
      return new Response(JSON.stringify({ 
        error: "Não há slots suficientes disponíveis nos próximos 7 dias",
        available_count: selectedSlots.length 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reserve each slot via Cal.com v2
    const reservationUids: string[] = [];
    for (const slot of selectedSlots) {
      try {
        const reserveRes = await fetch("https://api.cal.com/v2/slots/reservations", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CALCOM_API_KEY}`,
            "cal-api-version": CALCOM_SLOTS_API_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            eventTypeId: eventTypeId,
            slotStart: slot.start,
            slotEnd: undefined, // Cal.com calculates based on event type duration
            reservationDuration: 120, // 2 hours hold
          }),
        });

        if (reserveRes.ok) {
          const reserveData = await reserveRes.json();
          reservationUids.push(reserveData.data?.reservationUid || reserveData.data?.uid || "");
          console.log("Slot reserved:", slot.start, reserveData.data);
        } else {
          const errText = await reserveRes.text();
          console.error("Failed to reserve slot:", slot.start, errText);
          reservationUids.push("");
        }
      } catch (e) {
        console.error("Reserve slot error:", e);
        reservationUids.push("");
      }
    }

    // Save holds in the database
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    const holdsToInsert = selectedSlots.map((s, i) => ({
      company_id,
      lead_id,
      enrollment_id: enrollment_id || null,
      conversation_id: conversation_id || null,
      slot_datetime: s.start,
      status: "held",
      expires_at: expiresAt.toISOString(),
      preferred_channel: preferred_channel || null,
      cal_booking_uid: reservationUids[i] || null,
    }));

    const { data: insertedHolds, error: insertError } = await supabase
      .from("slot_holds")
      .insert(holdsToInsert)
      .select();

    if (insertError) throw insertError;

    // Format slots for display in messages
    const formattedSlots = selectedSlots.map(s => {
      const dt = new Date(s.start);
      return dt.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }) + " às " + dt.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    });

    return new Response(JSON.stringify({
      success: true,
      slots: insertedHolds,
      formatted: formattedSlots,
      expires_at: expiresAt.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("calcom-slots error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
