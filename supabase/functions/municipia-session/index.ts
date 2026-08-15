import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { signMunicipiaToken } from "../_shared/municipia-token.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Não autorizado" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: member } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const companyId = member?.company_id;
    if (!companyId) return json({ error: "Usuário sem empresa" }, 403);

    const { data: integ } = await admin
      .from("municipia_integrations")
      .select("enabled")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!integ?.enabled) return json({ error: "Integração MunicipIA não habilitada" }, 403);

    const expiresIn = 30 * 60;
    const token = await signMunicipiaToken({
      company_id: companyId,
      user_id: user.id,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    });

    return json({ token, company_id: companyId, expires_in: expiresIn });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
