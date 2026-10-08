// Master: reprocessa o enriquecimento de redes (Instagram/LinkedIn) dos leads atuais de uma empresa.
// Body: { company_id: uuid, limit?: number (1-500) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const { data: role } = await admin.from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "master_admin").maybeSingle();
    if (!role) return json({ error: "Apenas o master pode reprocessar" }, 403);

    const body = await req.json().catch(() => ({}));
    const companyId = String(body.company_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json({ error: "company_id inválido" }, 400);
    const limit = Math.max(1, Math.min(500, Number(body.limit) || 100));

    // Leads com site ou link de rede, sem job aberto
    const { data: open } = await admin.from("lead_enrichment_jobs").select("lead_id")
      .eq("company_id", companyId).in("status", ["pending", "processing"]).limit(5000);
    const openSet = new Set((open || []).map((o: any) => o.lead_id));

    const { data: candidates, error } = await admin.from("leads").select("id")
      .eq("company_id", companyId)
      .or("website.not.is.null,instagram_url.not.is.null,linkedin_url.not.is.null,linkedin_company_url.not.is.null")
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    if (error) return json({ error: error.message }, 500);

    const ids: string[] = [];
    let skippedProtected = 0;
    for (const c of candidates || []) {
      if (ids.length >= limit) break;
      if (openSet.has(c.id)) continue;
      const { data: prot } = await admin.rpc("is_lead_protected", { _lead_id: c.id });
      if (prot) { skippedProtected++; continue; }
      ids.push(c.id);
    }
    if (!ids.length) return json({ ok: true, queued: 0, skipped_protected: skippedProtected });

    const now = new Date().toISOString();
    await admin.from("lead_enrichment_jobs").insert(ids.map((lead_id) => ({ lead_id, company_id: companyId })));
    await admin.from("leads").update({ enrichment_status: "pending", enrichment_updated_at: now }).in("id", ids);
    return json({ ok: true, queued: ids.length, skipped_protected: skippedProtected });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
