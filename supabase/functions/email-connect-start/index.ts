// Starts a Nylas OAuth flow. Enforces the 5-slot free-tier cap.
// Returns { auth_url } for the frontend to redirect the user to.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAuthUrl,
  NYLAS_MAX_GRANTS,
  type NylasProvider,
} from "../_shared/nylas.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const auth = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { provider, redirect_origin } = await req.json();
    if (!["google", "microsoft", "imap"].includes(provider)) {
      return new Response(JSON.stringify({ error: "invalid provider" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the cap check (needs to see all grants).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { count } = await admin
      .from("user_email_grants")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if ((count ?? 0) >= NYLAS_MAX_GRANTS) {
      return new Response(
        JSON.stringify({
          error: "slot_limit",
          message:
            "Limite de contas de email conectadas atingido. Peça ao admin para liberar um slot.",
        }),
        {
          status: 409,
          headers: { ...CORS, "Content-Type": "application/json" },
        },
      );
    }

    // Compact state: base64(user_id|redirect_origin|random)
    const random = crypto.randomUUID();
    const statePayload = `${user.id}|${redirect_origin}|${random}`;
    const state = btoa(statePayload);

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-connect-callback`;
    const authUrl = buildAuthUrl({
      provider: provider as NylasProvider,
      redirectUri,
      state,
    });

    return new Response(JSON.stringify({ auth_url: authUrl }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("email-connect-start error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
