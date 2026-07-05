import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireCompanyMember, HttpError } from "../_shared/tenant-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Não autorizado" }, 401);

    const { company_id } = await req.json().catch(() => ({}));
    if (!company_id) return json({ error: "company_id obrigatório" }, 400);
    try { await requireCompanyMember(user.id, company_id); }
    catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 403); }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin
      .from("integrations")
      .select("status, api_token, config, updated_at, last_synced_at")
      .eq("company_id", company_id)
      .eq("provider", "apollo")
      .maybeSingle();

    const connected = !!data && data.status === "active" && !!data.api_token;
    const cfg = (data?.config ?? {}) as Record<string, any>;
    return json({
      connected,
      has_key: !!data?.api_token,
      last_check_at: cfg.last_check_at ?? data?.last_synced_at ?? null,
      last_error: cfg.last_error ?? null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
