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

  const { data: jobs, error } = await supabase
    .from("lead_enrichment_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("next_run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  for (const j of jobs || []) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/enrich-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ job_id: j.id }),
      });
      results.push({ id: j.id, status: r.status });
    } catch (e) {
      results.push({ id: j.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
