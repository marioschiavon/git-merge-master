import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    const CALCOM_EVENT_TYPE_ID = Deno.env.get("CALCOM_EVENT_TYPE_ID");
    if (!CALCOM_API_KEY || !CALCOM_EVENT_TYPE_ID) {
      throw new Error("Cal.com secrets not configured (CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID)");
    }

    const body = await req.json();
    const { company_id, lead_id, enrollment_id, conversation_id, preferred_channel } = body;

    if (!company_id || !lead_id) {
      return new Response(JSON.stringify({ error: "company_id and lead_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch available slots from Cal.com for the next 7 days
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const slotsRes = await fetch(
      `https://api.cal.com/v1/slots/available?apiKey=${CALCOM_API_KEY}&eventTypeId=${CALCOM_EVENT_TYPE_ID}&startTime=${startDate.toISOString()}&endTime=${endDate.toISOString()}`,
      { method: "GET" }
    );

    if (!slotsRes.ok) {
      const errText = await slotsRes.text();
      console.error("Cal.com API error:", errText);
      throw new Error(`Cal.com API error: ${slotsRes.status}`);
    }

    const slotsData = await slotsRes.json();
    // slotsData.slots is an object keyed by date: { "2024-01-15": [{time: "..."}], ... }
    const slots = slotsData.slots || {};

    // Pick 2 slots on different days
    const selectedSlots: { date: string; time: string }[] = [];
    const sortedDates = Object.keys(slots).sort();

    for (const date of sortedDates) {
      if (selectedSlots.length >= 2) break;
      const daySlots = slots[date];
      if (daySlots && daySlots.length > 0) {
        // Pick a slot around mid-day if possible
        const midIndex = Math.min(Math.floor(daySlots.length / 2), daySlots.length - 1);
        selectedSlots.push({ date, time: daySlots[midIndex].time });
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

    // Save holds in the database
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    const holdsToInsert = selectedSlots.map(s => ({
      company_id,
      lead_id,
      enrollment_id: enrollment_id || null,
      conversation_id: conversation_id || null,
      slot_datetime: s.time,
      status: "held",
      expires_at: expiresAt.toISOString(),
      preferred_channel: preferred_channel || null,
    }));

    const { data: insertedHolds, error: insertError } = await supabase
      .from("slot_holds")
      .insert(holdsToInsert)
      .select();

    if (insertError) throw insertError;

    // Format slots for display in messages
    const formattedSlots = selectedSlots.map(s => {
      const dt = new Date(s.time);
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
