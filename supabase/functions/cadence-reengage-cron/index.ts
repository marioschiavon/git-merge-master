import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cron worker: re-engage leads that replied to a cadence and then went silent.
 *
 * Scope: enrollments with status='paused' AND paused_reason='lead_replied'.
 *
 * Per-cadence config (in `cadences`):
 *   - reengage_enabled (bool, default true)
 *   - reengage_after_days (int, default 2)
 *   - reengage_max_attempts (int, default 3)
 *
 * Protections (skip re-engage):
 *   - meeting_scheduled = true on the enrollment
 *   - active slot_hold for the lead (status='held' and not expired)
 *   - confirmed booking for the lead in the last 90 days
 *
 * On re-engage: set status='active', clear paused_reason, next_execution_at=now(),
 * increment reengage_attempts. The cadence-executor picks it up on its next tick.
 *
 * When attempts exceed the configured max: mark completed with
 * paused_reason='no_response_after_reengage' and log a no_response intent.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats = { scanned: 0, reengaged: 0, exhausted: 0, skipped_meeting: 0, skipped_hold: 0, skipped_booking: 0, skipped_recent: 0, skipped_disabled: 0, skipped_no_step: 0, errors: 0 };

  try {
    const nowIso = new Date().toISOString();

    const { data: enrollments, error } = await supabase
      .from("cadence_enrollments")
      .select(`
        id, lead_id, company_id, cadence_id, current_step, meeting_scheduled,
        reengage_attempts, last_reengage_at, updated_at,
        cadences!inner(id, status, reengage_enabled, reengage_after_days, reengage_max_attempts)
      `)
      .eq("status", "paused")
      .eq("paused_reason", "lead_replied")
      .eq("meeting_scheduled", false)
      .limit(500);

    if (error) throw error;

    for (const e of enrollments || []) {
      stats.scanned++;
      try {
        const cad: any = (e as any).cadences;
        if (!cad || cad.status !== "active") continue;
        if (cad.reengage_enabled === false) { stats.skipped_disabled++; continue; }

        const afterDays = Math.max(1, Number(cad.reengage_after_days ?? 2));
        const maxAttempts = Math.max(1, Number(cad.reengage_max_attempts ?? 3));

        // Find most recent message for this lead's conversation
        const { data: convs } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", e.lead_id);
        const convIds = (convs || []).map((c: any) => c.id);

        let lastActivityAt: string | null = null;
        if (convIds.length) {
          const { data: lastMsg } = await supabase
            .from("messages")
            .select("created_at")
            .in("conversation_id", convIds)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          lastActivityAt = lastMsg?.created_at || null;
        }
        // Fallback: enrollment updated_at, last_reengage_at
        const candidates = [lastActivityAt, (e as any).last_reengage_at, (e as any).updated_at].filter(Boolean) as string[];
        if (candidates.length === 0) continue;
        const lastTs = Math.max(...candidates.map((t) => new Date(t).getTime()));
        const silenceMs = Date.now() - lastTs;
        if (silenceMs < afterDays * 86400 * 1000) { stats.skipped_recent++; continue; }

        // Protection: active slot_hold
        const { data: holds } = await supabase
          .from("slot_holds")
          .select("id, expires_at")
          .eq("lead_id", e.lead_id)
          .eq("status", "held");
        if ((holds || []).some((h: any) => !h.expires_at || new Date(h.expires_at).getTime() > Date.now())) {
          stats.skipped_hold++; continue;
        }

        // Protection: confirmed booking in last 90 days
        const cutoff90 = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
        const { data: bookings } = await supabase
          .from("bookings")
          .select("id")
          .eq("lead_id", e.lead_id)
          .gte("created_at", cutoff90)
          .limit(1);
        if (bookings && bookings.length) { stats.skipped_booking++; continue; }

        // Exhausted?
        if ((e.reengage_attempts ?? 0) >= maxAttempts) {
          await supabase
            .from("cadence_enrollments")
            .update({
              status: "completed",
              paused_reason: "no_response_after_reengage",
              completed_at: nowIso,
              next_execution_at: null,
            } as any)
            .eq("id", e.id);

          await supabase.from("lead_intents_log").insert({
            company_id: e.company_id,
            lead_id: e.lead_id,
            category: "no_response",
            metadata: { source: "cadence-reengage-cron", enrollment_id: e.id, attempts: e.reengage_attempts },
          } as any).then(() => null, () => null);

          await supabase.from("lead_activities").insert({
            company_id: e.company_id,
            lead_id: e.lead_id,
            type: "note",
            description: `🔕 Cadência encerrada — lead não respondeu após ${e.reengage_attempts} tentativas de reengajamento`,
          } as any).then(() => null, () => null);

          stats.exhausted++;
          continue;
        }

        // Verify there's a next step
        const { data: nextSteps } = await supabase
          .from("cadence_steps")
          .select("id, step_order")
          .eq("cadence_id", e.cadence_id)
          .gt("step_order", e.current_step ?? 0)
          .order("step_order", { ascending: true })
          .limit(1);
        if (!nextSteps || nextSteps.length === 0) { stats.skipped_no_step++; continue; }

        const newAttempts = (e.reengage_attempts ?? 0) + 1;
        const { error: updErr } = await supabase
          .from("cadence_enrollments")
          .update({
            status: "active",
            paused_reason: null,
            next_execution_at: nowIso,
            reengage_attempts: newAttempts,
            last_reengage_at: nowIso,
          } as any)
          .eq("id", e.id)
          .eq("status", "paused")
          .eq("paused_reason", "lead_replied");
        if (updErr) { stats.errors++; continue; }

        await supabase.from("lead_activities").insert({
          company_id: e.company_id,
          lead_id: e.lead_id,
          type: "note",
          description: `🔄 Reengajamento ${newAttempts}/${maxAttempts} — retomando cadência (lead silencioso há ${Math.floor(silenceMs / 86400000)}d)`,
        } as any).then(() => null, () => null);

        stats.reengaged++;
      } catch (innerErr) {
        console.error("[cadence-reengage-cron] enrollment error", e.id, innerErr);
        stats.errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cadence-reengage-cron] fatal", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err), stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
