import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cron worker: scans for time-based "silence" intents and queues follow-up actions.
 * - silence_after_interest: lead com último intent=interest há >48h sem nova mensagem
 * - abandoned_scheduling: slot oferecido há >24h sem aceite
 *
 * Also dispatches pending actions from lead_action_queue whose scheduled_for <= now.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const stats = { silence_queued: 0, abandoned_queued: 0, dispatched: 0, errors: 0 };

    // 1. silence_after_interest
    const cutoff48h = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
    const { data: silentLeads } = await supabase
      .from("lead_intents_log")
      .select("id, company_id, lead_id, conversation_id, created_at, category")
      .eq("category", "interest")
      .lte("created_at", cutoff48h)
      .order("created_at", { ascending: false })
      .limit(200);

    for (const log of silentLeads || []) {
      // skip if there's already a newer intent or pending action for this lead
      const { data: newer } = await supabase
        .from("lead_intents_log")
        .select("id")
        .eq("lead_id", log.lead_id)
        .gt("created_at", log.created_at)
        .limit(1);
      if (newer && newer.length) continue;

      const { data: pending } = await supabase
        .from("lead_action_queue")
        .select("id")
        .eq("lead_id", log.lead_id)
        .eq("status", "pending")
        .limit(1);
      if (pending && pending.length) continue;

      await supabase.from("lead_action_queue").insert({
        company_id: log.company_id,
        lead_id: log.lead_id,
        conversation_id: log.conversation_id,
        intent_log_id: log.id,
        action_type: "send_reply" as any,
        params: { followup: true, reason: "silence_after_interest" },
        scheduled_for: now.toISOString(),
        triggered_by: "intent-cron:silence",
      });
      stats.silence_queued++;
    }

    // 2. abandoned_scheduling (slot_holds offered >24h ago, still held)
    const cutoff24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const { data: stale } = await supabase
      .from("slot_holds")
      .select("id, lead_id, expires_at")
      .eq("status", "held")
      .lte("created_at", cutoff24h);

    for (const h of stale || []) {
      const { data: lead } = await supabase
        .from("leads")
        .select("company_id")
        .eq("id", h.lead_id)
        .maybeSingle();
      if (!lead) continue;
      await supabase.from("lead_action_queue").insert({
        company_id: lead.company_id,
        lead_id: h.lead_id,
        action_type: "suggest_meeting_times" as any,
        params: { reason: "abandoned_scheduling" },
        scheduled_for: now.toISOString(),
        triggered_by: "intent-cron:abandoned",
      });
      stats.abandoned_queued++;
    }

    // 3. dispatch pending actions whose time has come
    const { data: due } = await supabase
      .from("lead_action_queue")
      .select("id")
      .eq("status", "pending")
      .lte("scheduled_for", now.toISOString())
      .limit(50);

    for (const row of due || []) {
      const { error } = await supabase.functions.invoke("execute-action", { body: { action_id: row.id } });
      if (error) stats.errors++; else stats.dispatched++;
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("intent-cron error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
