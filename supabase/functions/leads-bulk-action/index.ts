// Ações em lote sobre leads: enviar N leads para uma cadência ou descartá-los.
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

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const { data: companyId } = await supabase.rpc("get_user_company_id", { _user_id: userData.user.id });
    if (!companyId) return json({ error: "no company" }, 403);

    const body = await req.json();
    const leadIds: string[] = Array.isArray(body.lead_ids) ? body.lead_ids : [];
    const action: string = body.action;
    const cadenceId: string | null = body.cadence_id || null;

    if (!leadIds.length) return json({ error: "lead_ids vazio" }, 400);
    if (!["enroll", "discard"].includes(action)) return json({ error: "action inválida" }, 400);

    // Filtra apenas leads da empresa
    const { data: validLeads } = await supabase
      .from("leads").select("id").eq("company_id", companyId).in("id", leadIds);
    const validIds = (validLeads || []).map((l: any) => l.id);
    if (!validIds.length) return json({ error: "nenhum lead válido" }, 400);

    if (action === "discard") {
      await supabase.from("leads")
        .update({ status: "unqualified", updated_at: new Date().toISOString() })
        .in("id", validIds);
      return json({ ok: true, discarded: validIds.length });
    }

    // enroll
    if (!cadenceId) return json({ error: "cadence_id obrigatório" }, 400);
    const { data: cadence } = await supabase.from("cadences")
      .select("id, status").eq("id", cadenceId).eq("company_id", companyId).maybeSingle();
    if (!cadence) return json({ error: "cadência não encontrada" }, 404);

    // Evita duplicar enrollments
    const { data: existing } = await supabase.from("cadence_enrollments")
      .select("lead_id").eq("cadence_id", cadenceId).in("lead_id", validIds);
    const alreadyIn = new Set((existing || []).map((r: any) => r.lead_id));
    const toInsert = validIds.filter((id) => !alreadyIn.has(id));

    if (toInsert.length) {
      const rows = toInsert.map((lead_id) => ({
        company_id: companyId,
        lead_id,
        cadence_id: cadenceId,
        status: "active",
        current_step: 0,
        first_message_status: "pending_generation",
        enrolled_at: new Date().toISOString(),
      }));
      const { error: insErr } = await supabase.from("cadence_enrollments").insert(rows);
      if (insErr) return json({ error: insErr.message }, 500);
    }

    return json({ ok: true, enrolled: toInsert.length, skipped: alreadyIn.size });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
