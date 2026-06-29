// Wrapper humano para cancelar reunião e opcionalmente avisar o lead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    const { conversation_id, booking_uid, reason, notify_lead, message_to_lead } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conv } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve booking_uid se não vier: pega o booking confirmado mais recente do lead
    let uid = booking_uid;
    if (!uid) {
      const { data: bk } = await admin
        .from("bookings")
        .select("calcom_booking_uid, status, scheduled_at")
        .eq("lead_id", conv.lead_id)
        .in("status", ["confirmed", "rescheduled", "pending"])
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      uid = bk?.calcom_booking_uid;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Nenhuma reunião ativa encontrada para cancelar" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const r = await admin.functions.invoke("calcom-booking-cancel", {
      body: { booking_uid: uid, reason: reason || "Cancelado pelo operador", lead_id: conv.lead_id, conversation_id },
    });
    if (r.error || r.data?.error) {
      return new Response(JSON.stringify({ error: r.error?.message || r.data?.error || "Falha ao cancelar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (notify_lead) {
      const text = (message_to_lead && String(message_to_lead).trim())
        || "Oi! Precisei desmarcar nossa reunião. Quer que eu te mande novas opções de horário?";
      await admin.functions.invoke("send-outbound-message", {
        headers: { Authorization: auth },
        body: { conversation_id, content: text, ai_suggested: false, metadata: { actor: "human", action: "cancel_booking", booking_uid: uid } },
      });
    }

    return new Response(JSON.stringify({ ok: true, cancelled: true, booking_uid: uid }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("human-cancel-booking error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
