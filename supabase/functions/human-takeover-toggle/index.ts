// Liga/desliga modo Humano em uma conversa.
// Quando liga: marca human_takeover=true, registra operador/motivo, cancela
// runs pendentes do debounce e pausa enrollments para que a IA não interfira.
// Quando desliga: devolve para IA e (opcional) re-enfileira o agente.
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
    const userId = userData.user.id;

    const { conversation_id, enable, reason, resume_agent } = await req.json();
    if (!conversation_id || typeof enable !== "boolean") {
      return new Response(JSON.stringify({ error: "conversation_id e enable são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conv, error: convErr } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id, cadence_enrollment_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date().toISOString();
    if (enable) {
      await admin.from("conversations").update({
        human_takeover: true,
        human_taken_at: now,
        human_taken_by: userId,
        human_takeover_reason: reason || "manual",
      }).eq("id", conversation_id);

      // Cancela runs pendentes do debounce para esse lead
      if (conv.lead_id) {
        await admin.from("pending_inbound_runs")
          .update({ status: "cancelled", last_error: "human_takeover" })
          .eq("lead_id", conv.lead_id)
          .in("status", ["pending", "running"]);
      }
      // Pausa enrollment vinculado para não disparar passo de cadência
      if (conv.cadence_enrollment_id) {
        await admin.from("cadence_enrollments").update({
          status: "paused",
          paused_reason: "human_takeover",
          next_execution_at: null,
        }).eq("id", conv.cadence_enrollment_id);
      }
      await admin.from("lead_activities").insert({
        company_id: conv.company_id,
        lead_id: conv.lead_id,
        type: "system",
        description: `👤 Operador assumiu a conversa (${reason || "manual"})`,
        metadata: { conversation_id, actor: "human", action: "takeover_on", user_id: userId },
      });
    } else {
      await admin.from("conversations").update({
        human_takeover: false,
        human_taken_at: null,
        human_taken_by: null,
        human_takeover_reason: null,
      }).eq("id", conversation_id);

      await admin.from("lead_activities").insert({
        company_id: conv.company_id,
        lead_id: conv.lead_id,
        type: "system",
        description: "🤖 Conversa devolvida para a IA",
        metadata: { conversation_id, actor: "human", action: "takeover_off", user_id: userId },
      });

      if (resume_agent && conv.lead_id) {
        // Reenfileira o agente em modo live para responder se houver inbound pendente
        const scheduledAt = new Date(Date.now() + 2_000).toISOString();
        await admin.from("pending_inbound_runs").upsert({
          lead_id: conv.lead_id,
          company_id: conv.company_id,
          conversation_id,
          scheduled_at: scheduledAt,
          last_inbound_at: now,
          status: "pending",
          claimed_at: null,
          last_error: null,
        }, { onConflict: "lead_id" });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("human-takeover-toggle error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
