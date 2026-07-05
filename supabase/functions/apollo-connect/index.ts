import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { validateApolloKey } from "../_shared/apollo.ts";
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

    const { api_key, company_id } = await req.json();
    if (!api_key || !company_id) return json({ error: "api_key e company_id obrigatórios" }, 400);

    try { await requireCompanyMember(user.id, company_id); }
    catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 403); }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate against Apollo (uses admin client to write telemetry).
    await validateApolloKey({ apiKey: String(api_key).trim(), company_id, supabase: admin, triggered_by: user.id });

    const { error } = await admin
      .from("integrations")
      .upsert({
        company_id,
        provider: "apollo",
        api_token: String(api_key).trim(),
        status: "active",
        config: { last_check_at: new Date().toISOString() },
      }, { onConflict: "company_id,provider" });
    if (error) return json({ error: error.message }, 500);

    return json({ success: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
