// OAuth callback. Receives code+state from Nylas, exchanges for a grant,
// stores it in user_email_grants, then 302 redirects back to /settings/email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { exchangeCode, NYLAS_MAX_GRANTS } from "../_shared/nylas.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const redirectHome = (origin: string, params: Record<string, string>) => {
    const to = new URL(`${origin}/settings/email`);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: to.toString() } });
  };

  // Best-effort decode state to get origin even on error
  let origin = "https://app.leaderei.com.br";
  let userId = "";
  if (state) {
    try {
      const [u, o] = atob(state).split("|");
      userId = u;
      if (o) origin = o;
    } catch { /* ignore */ }
  }

  if (errorParam) return redirectHome(origin, { connect_error: errorParam });
  if (!code || !userId) return redirectHome(origin, { connect_error: "missing_code" });

  try {
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-connect-callback`;
    const grant = await exchangeCode({ code, redirectUri });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Re-check the cap right before insert (race safety).
    const { count } = await admin
      .from("user_email_grants")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if ((count ?? 0) >= NYLAS_MAX_GRANTS) {
      return redirectHome(origin, { connect_error: "slot_limit" });
    }

    const { data: membership } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership?.company_id) {
      return redirectHome(origin, { connect_error: "no_company" });
    }

    const { error: upsertErr } = await admin.from("user_email_grants").upsert(
      {
        user_id: userId,
        company_id: membership.company_id,
        provider: grant.provider,
        grant_id: grant.grant_id,
        email: grant.email,
        status: "active",
        scopes: grant.scope ? grant.scope.split(" ") : [],
        last_error: null,
        warmup_started_at: new Date().toISOString(),
      },
      { onConflict: "user_id,email" },
    );
    if (upsertErr) {
      console.error("callback upsert error", upsertErr);
      return redirectHome(origin, { connect_error: "save_failed" });
    }

    return redirectHome(origin, { connected: "1", email: grant.email });
  } catch (e) {
    console.error("email-connect-callback error", e);
    return redirectHome(origin, { connect_error: "exchange_failed" });
  }
});
