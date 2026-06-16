// Wrapper para o operador humano: busca slots no Cal.com via a função calcom-slots
// (que já reserva os holds) e devolve formatado pronto para inserir no chat.
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

    const { conversation_id, start_after, end_before } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conv } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id, channel, cadence_enrollment_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const slotsRes = await admin.functions.invoke("calcom-slots", {
      body: {
        company_id: conv.company_id,
        lead_id: conv.lead_id,
        enrollment_id: conv.cadence_enrollment_id || null,
        conversation_id: conv.id,
        preferred_channel: conv.channel,
        start_after,
        end_before,
      },
    });

    if (slotsRes.error) {
      return new Response(JSON.stringify({ error: slotsRes.error.message || "Falha ao buscar slots" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = slotsRes.data as any;
    const slots = (data?.slots || []) as any[];
    const formatted = slots.map((s) => ({
      hold_id: s.id,
      slot_datetime: s.slot_datetime,
      label: formatBRTLong(s.slot_datetime),
    }));

    let suggested = "";
    if (formatted.length >= 2) {
      suggested = `Posso te oferecer dois horários:\n• ${formatted[0].label}\n• ${formatted[1].label}\n\nQual fica melhor?`;
    } else if (formatted.length === 1) {
      suggested = `Tenho disponibilidade em ${formatted[0].label}. Funciona pra você?`;
    } else {
      suggested = "Não encontrei horários abertos nessa janela. Me diga um dia ou período melhor que eu reabro a agenda.";
    }

    return new Response(JSON.stringify({ ok: true, slots: formatted, suggested_message: suggested }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("human-offer-slots error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
