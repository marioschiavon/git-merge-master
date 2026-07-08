// Enfileira mais N leads que estão com enrichment_status='not_queued'.
// Uso: { limit: number, lead_list_id?: string }
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
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, Number(body.limit) || 50));
    const lead_list_id: string | null = body.lead_list_id || null;

    // Descobre a company do usuário
    const { data: cm } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const companyId = cm?.company_id;
    console.log("[enrichment-enqueue-more] user", userData.user.id, "company", companyId, "limit", limit, "lead_list_id", lead_list_id);
    if (!companyId) return json({ error: "Empresa não identificada" }, 400);

    // Busca leads em espera
    let q = admin
      .from("leads")
      .select("id")
      .eq("company_id", companyId)
      .eq("enrichment_status", "not_queued")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (lead_list_id) q = q.eq("lead_list_id", lead_list_id);
    const { data: leads, error } = await q;
    console.log("[enrichment-enqueue-more] query result count=", leads?.length, "error=", error);
    if (error) return json({ error: error.message }, 500);
    const ids = (leads || []).map((l: any) => l.id);
    if (ids.length === 0) return json({ ok: true, released: 0 });

    // Libera o gatilho: seta enrichment_status=null e insere jobs
    const now = new Date().toISOString();
    await admin.from("leads")
      .update({ enrichment_status: "pending", enrichment_updated_at: now })
      .in("id", ids);

    // Insere jobs (ignora conflitos de pending/processing já existentes)
    const rows = ids.map((leadId: string) => ({ lead_id: leadId, company_id: companyId }));
    await admin.from("lead_enrichment_jobs").insert(rows);

    return json({ ok: true, released: ids.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
