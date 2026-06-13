// sdr-debounce-tick: roda no cron a cada ~10s.
// Coleta entradas pending em `pending_inbound_runs` cujo scheduled_at já venceu,
// marca como `running` (lock atômico via UPDATE … RETURNING) e dispara o sdr-agent
// uma única vez por lead (coalescendo várias mensagens recebidas em sequência).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 5;
const STALE_RUNNING_MIN = 5; // re-arma se ficou "running" sem terminar por > 5min

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 0. Recupera runs travados em "running" há muito tempo → volta pra pending.
    await supabase
      .from("pending_inbound_runs")
      .update({ status: "pending", claimed_at: null })
      .eq("status", "running")
      .lt("claimed_at", new Date(Date.now() - STALE_RUNNING_MIN * 60_000).toISOString());

    // 1. Seleciona pending vencidos
    const { data: due, error: selErr } = await supabase
      .from("pending_inbound_runs")
      .select("lead_id, company_id, conversation_id, scheduled_at, attempts")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(MAX_BATCH);

    if (selErr) {
      console.error("sdr-debounce-tick select error:", selErr);
      return new Response(JSON.stringify({ ok: false, error: String(selErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<Record<string, unknown>> = [];

    for (const row of due ?? []) {
      // 2. Lock atômico: só processa quem conseguir marcar como running
      const claimedAt = new Date().toISOString();
      const { data: claimed, error: claimErr } = await supabase
        .from("pending_inbound_runs")
        .update({ status: "running", claimed_at: claimedAt, attempts: (row.attempts ?? 0) + 1 })
        .eq("lead_id", row.lead_id)
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .select("lead_id")
        .maybeSingle();

      if (claimErr || !claimed) {
        results.push({ lead_id: row.lead_id, skipped: true, reason: claimErr ? String(claimErr) : "not_claimable" });
        continue;
      }

      // 3. Dispara o agente em modo live (trigger=inbound_batch indica coalescência)
      try {
        const { error: invErr } = await supabase.functions.invoke("sdr-agent", {
          body: {
            lead_id: row.lead_id,
            conversation_id: row.conversation_id ?? undefined,
            trigger: "inbound_batch",
            mode: "live",
          },
        });

        if (invErr) {
          const reason = String(invErr);
          const giveUp = (row.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
          await supabase
            .from("pending_inbound_runs")
            .update({
              status: giveUp ? "failed" : "pending",
              claimed_at: null,
              last_error: reason,
              scheduled_at: giveUp ? row.scheduled_at : new Date(Date.now() + 30_000).toISOString(),
            })
            .eq("lead_id", row.lead_id);
          results.push({ lead_id: row.lead_id, ok: false, error: reason, give_up: giveUp });
          continue;
        }

        await supabase
          .from("pending_inbound_runs")
          .update({ status: "done", last_error: null })
          .eq("lead_id", row.lead_id);
        results.push({ lead_id: row.lead_id, ok: true });
      } catch (e) {
        const reason = String(e);
        await supabase
          .from("pending_inbound_runs")
          .update({
            status: "pending",
            claimed_at: null,
            last_error: reason,
            scheduled_at: new Date(Date.now() + 30_000).toISOString(),
          })
          .eq("lead_id", row.lead_id);
        results.push({ lead_id: row.lead_id, ok: false, error: reason });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sdr-debounce-tick fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
