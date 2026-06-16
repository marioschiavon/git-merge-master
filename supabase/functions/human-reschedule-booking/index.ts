// Wrapper humano para remarcar reunião existente para um novo horário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { formatBRTLong } from "../_shared/datetime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { conversation_id, booking_uid, start, reason, notify_lead, guests } = await req.json();
    if (!conversation_id || !start) {
      return new Response(JSON.stringify({ error: "conversation_id e start são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cleanGuests: string[] = Array.isArray(guests)
      ? Array.from(new Set(
          guests
            .map((g: unknown) => String(g || "").trim().toLowerCase())
            .filter((g: string) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g)),
        ))
      : [];

    const { data: conv } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let uid = booking_uid;
    if (!uid) {
      const { data: bk } = await admin
        .from("bookings")
        .select("calcom_booking_uid")
        .eq("lead_id", conv.lead_id)
        .in("status", ["confirmed", "rescheduled", "pending"])
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      uid = bk?.calcom_booking_uid;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Nenhuma reunião ativa para remarcar" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const r = await admin.functions.invoke("calcom-booking-reschedule", {
      body: { booking_uid: uid, start, reason: reason || "Remarcado pelo operador", lead_id: conv.lead_id, conversation_id },
    });
    if (r.error || r.data?.error) {
      return new Response(JSON.stringify({ error: r.error?.message || r.data?.error || "Falha ao remarcar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const newUid = r.data?.booking?.uid || r.data?.booking_uid || uid;

    if (cleanGuests.length > 0) {
      await admin.functions.invoke("calcom-add-guests", {
        body: { booking_uid: newUid, guests: cleanGuests, lead_id: conv.lead_id, conversation_id },
      }).catch((e) => console.error("add-guests failed", e));
    }

    if (notify_lead) {
      const text = `Remarquei nossa reunião para ${formatBRTLong(start)}. Você receberá um novo convite por e-mail. 🚀`;
      await admin.functions.invoke("send-outbound-message", {
        headers: { Authorization: auth },
        body: { conversation_id, content: text, ai_suggested: false, metadata: { actor: "human", action: "reschedule_booking", booking_uid: newUid } },
      });
    }

    return new Response(JSON.stringify({ ok: true, rescheduled: true, booking_uid: newUid }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("human-reschedule-booking error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
