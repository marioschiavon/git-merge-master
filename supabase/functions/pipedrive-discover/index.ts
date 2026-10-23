import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createPipedriveClient } from "../_shared/pipedrive.ts";
import { requireCompanyMember, HttpError } from "../_shared/tenant-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (p: unknown, s = 200) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE_PERSON = new Set(["name", "email", "phone", "org_id", "owner_id"]);
const EDITABLE = new Set(["varchar", "varchar_auto", "text", "double", "monetary", "phone", "date", "address", "enum", "int"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Não autorizado" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Não autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const companyId = typeof body?.company_id === "string" ? body.company_id : "";
    if (!companyId) return json({ error: "company_id é obrigatório" }, 400);
    try {
      await requireCompanyMember(user.id, companyId);
    } catch (e) {
      return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 403);
    }

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: integ } = await admin.from("integrations").select("api_token, status")
      .eq("company_id", companyId).eq("provider", "pipedrive").maybeSingle();
    if (!integ || integ.status !== "active" || !integ.api_token) return json({ error: "Pipedrive não conectado" }, 404);

    const pd = createPipedriveClient(integ.api_token);
    const [pipelines, stages, users, personFields, dealFields] = await Promise.all([
      pd.get<any[]>("/pipelines"),
      pd.get<any[]>("/stages"),
      pd.get<any[]>("/users"),
      pd.get<any[]>("/personFields", { limit: 500 }),
      pd.get<any[]>("/dealFields", { limit: 500 }),
    ]);

    const mapFields = (list: any[] | null, entity: "person" | "deal") =>
      (list ?? [])
        .filter((f) => f.edit_flag || (entity === "person" ? BASE_PERSON.has(f.key) : f.key === "title" || f.key === "value"))
        .filter((f) => EDITABLE.has(f.field_type) || f.key === "title" || f.key === "name")
        .filter((f) => !["org_id", "owner_id", "person_id"].includes(f.key))
        .map((f) => ({ code: String(f.key), label: String(f.name), type: String(f.field_type) }));

    return json({
      pipelines: (pipelines ?? []).filter((p) => p.active !== false).map((p) => ({ id: String(p.id), name: p.name })),
      stages: (stages ?? []).map((s) => ({ id: String(s.id), name: s.name, pipeline_id: String(s.pipeline_id), order: s.order_nr })),
      users: (users ?? []).filter((u) => u.active_flag !== false).map((u) => ({ id: String(u.id), name: u.name })),
      person: mapFields(personFields, "person"),
      deal: mapFields(dealFields, "deal"),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
