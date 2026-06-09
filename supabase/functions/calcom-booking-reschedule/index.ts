import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, corsHeaders, jsonResponse, upsertBookingFromCalcom } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { booking_uid, start, reason, lead_id } = body;
    if (!booking_uid || !start) return jsonResponse({ error: "booking_uid and start required" }, 400);

    const result = await calcomFetch(`/v2/bookings/${booking_uid}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ start, reschedulingReason: reason || "Cliente solicitou remarcação" }),
    });
    const data = result.data || result;

    // Mark previous as rescheduled
    const { data: prev } = await supabase
      .from("bookings")
      .select("id, company_id, lead_id, conversation_id")
      .eq("calcom_booking_uid", booking_uid)
      .maybeSingle();

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
        metadata: { previous_uid: booking_uid, new_uid: data.uid, reason },
      });
    }

    return jsonResponse({ success: true, booking: data });
  } catch (e) {
    console.error("calcom-booking-reschedule error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
