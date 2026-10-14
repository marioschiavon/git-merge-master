import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAsAppUser, exchangeAppUserOAuthCode, GATEWAY_BASE_URL } from "../_shared/appUserConnector.ts";
import { GMAIL_SCOPES, saveConnectionKeyForUser } from "../_shared/appUserConnections.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { code } = await req.json().catch(() => ({}));
    if (typeof code !== "string" || !code || code.length > 2000) return json({ error: "code inválido" }, 400);

    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, code);
    if (connectorId !== "google_mail") return json({ error: "conector inesperado" }, 400);
    await saveConnectionKeyForUser(user.id, connectorId, connectionAPIKey);

    // Descobre o endereço da caixa conectada
    const prof = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL, connectionAPIKey, connectorId: "google_mail",
      path: "/gmail/v1/users/me/profile", requiredScopes: GMAIL_SCOPES,
    });
    if (!prof.ok) {
      const t = await prof.text();
      console.error("gmail profile failed", prof.status, t);
      return json({ error: "Não foi possível ler o perfil do Gmail", status: prof.status, details: t }, 502);
    }
    const email = String((await prof.json()).emailAddress || "").toLowerCase();

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: companyId } = await admin.rpc("get_user_company_id", { _user_id: user.id });
    const { data: prof2 } = await admin.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();
    const profile = { company_id: companyId as string | null, full_name: prof2?.full_name ?? null };
    if (!profile.company_id) return json({ error: "Usuário sem empresa" }, 400);

    const { error } = await admin.from("user_email_grants").upsert({
      user_id: user.id,
      company_id: profile.company_id,
      provider: "google",
      transport: "gmail",
      grant_id: `gmail:${user.id}`,
      email,
      display_name: (profile as any).full_name ?? null,
      status: "active",
      scopes: GMAIL_SCOPES,
      last_error: null,
    }, { onConflict: "user_id,email" });
    if (error) throw error;

    return json({ ok: true, email });
  } catch (e) {
    console.error("gmail-oauth-complete", e);
    return json({ error: (e as Error).message }, 500);
  }
});
