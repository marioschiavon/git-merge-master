import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, corsHeaders, jsonResponse, upsertBookingFromCalcom } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { lead_id, conversation_id, start, event_type_id, attendee_name, attendee_email, timezone, language, notes } = body;

    if (!start) return jsonResponse({ error: "start (ISO datetime) required" }, 400);

    let lead: any = null;
    if (lead_id) {
      const { data } = await supabase.from("leads").select("id, company_id, name, email").eq("id", lead_id).single();
      lead = data;
    }

    const name = attendee_name || lead?.name;
    const email = attendee_email || lead?.email;
    if (!name || !email) return jsonResponse({ error: "attendee_name and attendee_email required" }, 400);

    let eventTypeId = event_type_id;
    if (!eventTypeId && lead?.company_id) {
      const { data: comp } = await supabase.from("companies").select("calcom_default_event_type_id").eq("id", lead.company_id).maybeSingle();
      eventTypeId = comp?.calcom_default_event_type_id;
    }
    if (!eventTypeId) {
      const envId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
      if (envId) eventTypeId = Number(envId);
    }
    if (!eventTypeId) return jsonResponse({ error: "event_type_id not resolvable" }, 400);

    const calBody = {
      eventTypeId: Number(eventTypeId),
      start,
      attendee: {
        name,
        email,
        timeZone: timezone || "America/Sao_Paulo",
        language: language || "pt",
      },
      ...(notes ? { bookingFieldsResponses: { notes } } : {}),
    };

    const result = await calcomFetch("/v2/bookings", { method: "POST", body: JSON.stringify(calBody) });
    const data = result.data || result;

    const booking = await upsertBookingFromCalcom(supabase, data, {
      company_id: lead?.company_id,
      lead_id: lead?.id || null,
      conversation_id: conversation_id || null,
    });
    if (booking) {
      await supabase.from("bookings").update({ status: "confirmed" }).eq("id", booking.id);
    }

    if (lead?.company_id) {
      await supabase.from("lead_activities").insert({
        company_id: lead.company_id,
        lead_id: lead.id,
        type: "meeting",
        description: `✅ Reunião agendada para ${new Date(start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
        metadata: { booking_uid: data.uid, event_type_id: eventTypeId },
      });
    }

    return jsonResponse({ success: true, booking: data, persisted: booking });
  } catch (e) {
    console.error("calcom-booking-create error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
