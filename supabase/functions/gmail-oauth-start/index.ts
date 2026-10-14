import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authorizeAppUserOAuth, GATEWAY_BASE_URL } from "../_shared/appUserConnector.ts";
import { getConnectionKeyForUser, GMAIL_SCOPES } from "../_shared/appUserConnections.ts";

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

    const clientAPIKey = Deno.env.get("GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY");
    if (!clientAPIKey) return json({ error: "Gmail não configurado" }, 500);

    const { origin } = await req.json().catch(() => ({}));
    let parsed: URL;
    try { parsed = new URL(String(origin)); } catch { return json({ error: "origin inválido" }, 400); }
    const returnUrl = new URL("/oauth/gmail/return", parsed.origin).toString();

    const existing = await getConnectionKeyForUser(user.id, "google_mail");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: "google_mail",
      appUserId: user.id,
      clientAPIKey,
      returnUrl,
      connectionAPIKey: existing ?? undefined,
      credentialsConfiguration: { scopes: GMAIL_SCOPES },
    });
    return json({ authorizationUrl });
  } catch (e) {
    console.error("gmail-oauth-start", e);
    return json({ error: (e as Error).message }, 500);
  }
});
