import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { verifyState } from "../_shared/gmail-oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlRedirect(url: string, message: string): Response {
  const safe = url.replace(/"/g, "&quot;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Gmail</title>
     <meta http-equiv="refresh" content="0; url=${safe}">
     </head><body style="font-family:system-ui;padding:2rem">
     <p>${message}</p><p><a href="${safe}">Continuar</a></p>
     </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  try {
    if (providerError) {
      return htmlRedirect(
        state ? await originFromState(state, "?gmail_error=" + encodeURIComponent(providerError)) : "/",
        `Google recusou a autorização: ${providerError}`,
      );
    }
    if (!code || !state) {
      return new Response("Parâmetros ausentes", { status: 400 });
    }

    const payload = await verifyState(state);
    const returnUrl = `${payload.origin}/settings/gmail?connected=1`;
    const errorUrl = (msg: string) =>
      `${payload.origin}/settings/gmail?gmail_error=${encodeURIComponent(msg)}`;

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

    // Exchange code
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("token exchange failed:", tokenRes.status, t);
      return htmlRedirect(errorUrl(`token exchange ${tokenRes.status}`), "Falha ao trocar código.");
    }
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      // Happens when user previously connected and Google skips refresh_token.
      // We forced prompt=consent so this shouldn't happen normally, but guard:
      return htmlRedirect(
        errorUrl("Google não retornou refresh_token. Remova o acesso em https://myaccount.google.com/permissions e tente novamente."),
        "Sem refresh_token.",
      );
    }

    // Fetch profile
    const profileRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profileRes.ok) {
      const t = await profileRes.text();
      console.error("profile fetch failed:", profileRes.status, t);
      return htmlRedirect(errorUrl(`profile ${profileRes.status}`), "Falha ao ler perfil Gmail.");
    }
    const profile = await profileRes.json();

    // Fetch userinfo to get google_user_id (sub)
    const userinfoRes = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const userinfo = userinfoRes.ok ? await userinfoRes.json() : { sub: null };

    const expiresIn: number = tokens.expires_in ?? 3600;
    const accessExpiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: rpcErr } = await admin.rpc("set_gmail_oauth_tokens", {
      _company_id: payload.company_id,
      _email: profile.emailAddress,
      _refresh_token: tokens.refresh_token,
      _access_token: tokens.access_token,
      _access_token_expires_at: accessExpiresAt,
      _scope: tokens.scope ?? null,
      _google_user_id: userinfo.sub ?? null,
      _passphrase: Deno.env.get("GMAIL_TOKEN_PASSPHRASE")!,
    });

    if (rpcErr) {
      console.error("set_gmail_oauth_tokens error:", rpcErr);
      return htmlRedirect(errorUrl(`db: ${rpcErr.message}`), "Falha ao salvar tokens.");
    }

    return htmlRedirect(returnUrl, `Gmail conectado: ${profile.emailAddress}. Redirecionando…`);
  } catch (err) {
    console.error("gmail-oauth-callback exception:", err);
    return new Response(`Erro: ${(err as Error).message}`, { status: 500 });
  }
});

async function originFromState(state: string, suffix = ""): Promise<string> {
  try {
    const p = await verifyState(state);
    return `${p.origin}/settings/gmail${suffix}`;
  } catch {
    return "/";
  }
}
