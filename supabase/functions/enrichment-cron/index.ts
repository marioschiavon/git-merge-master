import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Recover zombie jobs: processing for > 10 min get reset to pending
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: zombies } = await supabase
    .from("lead_enrichment_jobs")
    .select("id, lead_id")
    .eq("status", "processing")
    .lt("updated_at", cutoff);
  if (zombies && zombies.length) {
    await supabase.from("lead_enrichment_jobs")
      .update({ status: "pending", next_run_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: "recovered from stuck processing" })
      .in("id", zombies.map((z: any) => z.id));
    await supabase.from("leads")
      .update({ enrichment_status: "pending", enrichment_updated_at: new Date().toISOString() })
      .in("id", zombies.map((z: any) => z.lead_id));
  }

  const { data: jobs, error } = await supabase
    .from("lead_enrichment_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("next_run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Fan out jobs in parallel — each enrich-lead invocation still handles a single
  // lead sequentially, but the cron no longer serializes the whole batch.
  const settled = await Promise.allSettled(
    (jobs || []).map(async (j: any) => {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/enrich-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ job_id: j.id }),
      });
      return { id: j.id, status: r.status };
    }),
  );
  const results = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { id: (jobs || [])[i]?.id, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  );

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
