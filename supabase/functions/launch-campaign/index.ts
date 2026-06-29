// Lança uma campanha em lote a partir de uma lead_list.
// Body: { list_id, cadence_id, mode: 'review'|'auto'|'scheduled', scheduled_for?, lead_ids?, filters? }
// - Cria registro em `campaigns`.
// - Cria cadence_enrollments para todos os leads selecionados.
// - first_message_status = 'pending_generation' (a geração ocorre via cron).
// - Se mode='auto', a cadência precisa ter auto_approve_first_message=true (é setado aqui).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { list_id, cadence_id, mode, scheduled_for, lead_ids, filters, name } = body || {};
    if (!list_id || !cadence_id || !mode) return json({ error: "list_id, cadence_id, mode required" }, 400);
    if (!["review", "auto", "scheduled"].includes(mode)) return json({ error: "invalid mode" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve company
    const { data: list } = await supabase.from("lead_lists").select("*").eq("id", list_id).maybeSingle();
    if (!list) return json({ error: "list not found" }, 404);
    const companyId = list.company_id;

    // Resolve leads
    let q = supabase.from("leads").select("id, email, enrichment_status").eq("lead_list_id", list_id).eq("company_id", companyId);
    if (Array.isArray(lead_ids) && lead_ids.length > 0) q = q.in("id", lead_ids);
    if (filters?.only_enriched) q = q.eq("enrichment_status", "completed");
    if (filters?.require_email) q = q.not("email", "is", null);
    const { data: leads, error: leadsErr } = await q;
    if (leadsErr) return json({ error: leadsErr.message }, 500);
    const leadList = leads || [];

    // Configure cadence for auto mode if requested
    if (mode === "auto") {
      await supabase.from("cadences").update({ auto_approve_first_message: true }).eq("id", cadence_id);
    }

    // Create campaign row
    const { data: campaign, error: cErr } = await supabase.from("campaigns").insert({
      company_id: companyId,
      list_id,
      cadence_id,
      name: name || `Campanha ${new Date().toLocaleString("pt-BR")}`,
      mode,
      scheduled_for: scheduled_for || null,
      total_leads: leadList.length,
      filters: filters || {},
      created_by: u.user.id,
      status: mode === "scheduled" && scheduled_for ? "running" : "running",
    }).select().single();
    if (cErr) return json({ error: cErr.message }, 500);

    // Enroll leads (skip already-enrolled). Schedule respects scheduled_for via enrolled_at.
    const enrolledAt = (mode === "scheduled" && scheduled_for) ? scheduled_for : new Date().toISOString();
    let enrolled = 0;
    for (const ld of leadList) {
      const { data: existing } = await supabase
        .from("cadence_enrollments")
        .select("id")
        .eq("lead_id", ld.id)
        .eq("cadence_id", cadence_id)
        .maybeSingle();
      if (existing) continue;
      const { error: insErr } = await supabase.from("cadence_enrollments").insert({
        company_id: companyId,
        lead_id: ld.id,
        cadence_id,
        status: "active",
        first_message_status: "pending_generation",
        current_step: 0,
        enrolled_at: enrolledAt,
      });
      if (!insErr) enrolled++;
    }
    await supabase.from("campaigns").update({ enrolled_count: enrolled }).eq("id", campaign.id);

    return json({ ok: true, campaign_id: campaign.id, enrolled, total: leadList.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
