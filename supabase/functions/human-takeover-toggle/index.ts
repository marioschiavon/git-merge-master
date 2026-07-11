// Liga/desliga modo Humano em uma conversa.
// Quando liga: marca human_takeover=true, registra operador/motivo, cancela
// runs pendentes do debounce e pausa enrollments para que a IA não interfira.
// Quando desliga: devolve para IA e (opcional) re-enfileira o agente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (tag: string, data: Record<string, unknown>) => {
  console.log(`[human-takeover-toggle] ${tag} ${JSON.stringify(data)}`);
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

    const body = await req.json();
    const { conversation_id, enable, reason, resume_agent } = body;
    log("received", { conversation_id, enable, reason, resume_agent, userId });

    if (!conversation_id || typeof enable !== "boolean") {
      return new Response(JSON.stringify({ error: "conversation_id e enable são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conv, error: convErr } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id, cadence_enrollment_id, human_takeover")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr || !conv) {
      log("conv_not_found", { conversation_id, error: convErr?.message });
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    log("conv_loaded", {
      conversation_id,
      lead_id: conv.lead_id,
      cadence_enrollment_id: conv.cadence_enrollment_id,
      was_human_takeover: conv.human_takeover,
    });

    const now = new Date().toISOString();
    if (enable) {
      await admin.from("conversations").update({
        human_takeover: true,
        human_taken_at: now,
        human_taken_by: userId,
        human_takeover_reason: reason || "manual",
      }).eq("id", conversation_id);
      log("enabled_human", { conversation_id });

      if (conv.lead_id) {
        const { data: cancelled } = await admin.from("pending_inbound_runs")
          .update({ status: "cancelled", last_error: "human_takeover" })
          .eq("lead_id", conv.lead_id)
          .in("status", ["pending", "running"])
          .select("lead_id");
        log("cancelled_pending_runs", { count: cancelled?.length ?? 0 });
      }
      if (conv.cadence_enrollment_id) {
        const { data: paused } = await admin.from("cadence_enrollments").update({
          status: "paused",
          paused_reason: "human_takeover",
          next_execution_at: null,
        }).eq("id", conv.cadence_enrollment_id).select("id, status, paused_reason");
        log("paused_enrollment", { paused });
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
      log("disabled_human", { conversation_id });

      await admin.from("lead_activities").insert({
        company_id: conv.company_id,
        lead_id: conv.lead_id,
        type: "system",
        description: "🤖 Conversa devolvida para a IA",
        metadata: { conversation_id, actor: "human", action: "takeover_off", user_id: userId },
      });

      // Inspeciona enrollment antes de despausar
      if (conv.cadence_enrollment_id) {
        const { data: currentEnr } = await admin
          .from("cadence_enrollments")
          .select("id, status, paused_reason, current_step, next_execution_at")
          .eq("id", conv.cadence_enrollment_id)
          .maybeSingle();
        log("enrollment_state_before_resume", { currentEnr });

        const { data: resumed, error: resumeErr } = await admin
          .from("cadence_enrollments")
          .update({
            status: "active",
            paused_reason: null,
            next_execution_at: now,
          })
          .eq("id", conv.cadence_enrollment_id)
          .eq("paused_reason", "human_takeover")
          .select("id, status, paused_reason, next_execution_at")
          .maybeSingle();
        log("resume_enrollment_result", { resumed, error: resumeErr?.message });

        if (resumed) {
          await admin.from("lead_activities").insert({
            company_id: conv.company_id,
            lead_id: conv.lead_id,
            type: "system",
            description: "▶️ Cadência retomada após devolução para a IA",
            metadata: { conversation_id, enrollment_id: conv.cadence_enrollment_id, actor: "human", user_id: userId },
          });
        }
      } else {
        log("no_enrollment_linked", { conversation_id });
      }

      // Verifica última mensagem inbound para decidir se há algo para o SDR responder
      if (conv.lead_id) {
        const { data: lastInbound } = await admin
          .from("messages")
          .select("id, sent_at, direction, content")
          .eq("conversation_id", conversation_id)
          .eq("direction", "inbound")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: lastMsg } = await admin
          .from("messages")
          .select("id, sent_at, direction")
          .eq("conversation_id", conversation_id)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        log("last_messages", {
          last_inbound: lastInbound ? { id: lastInbound.id, sent_at: lastInbound.sent_at } : null,
          last_any: lastMsg ? { id: lastMsg.id, sent_at: lastMsg.sent_at, direction: lastMsg.direction } : null,
          has_inbound_to_reply: !!lastInbound,
        });
      }

      if (resume_agent && conv.lead_id) {
        const scheduledAt = new Date(Date.now() + 2_000).toISOString();
        const { data: upserted, error: upsertErr } = await admin.from("pending_inbound_runs").upsert({
          lead_id: conv.lead_id,
          company_id: conv.company_id,
          conversation_id,
          scheduled_at: scheduledAt,
          last_inbound_at: now,
          status: "pending",
          claimed_at: null,
          last_error: null,
        }, { onConflict: "lead_id" }).select("lead_id, status, scheduled_at");
        log("enqueued_pending_run", { upserted, error: upsertErr?.message, scheduledAt });
      } else {
        log("skipped_enqueue", { resume_agent, has_lead: !!conv.lead_id });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[human-takeover-toggle] fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
