import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: role } = await admin
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "master_admin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const apifyTokenConfigured = !!Deno.env.get("APIFY_API_TOKEN");
    const resendApiKeyConfigured = !!(Deno.env.get("RESEND_API_KEY") ?? "").trim();
    const lovableApiKeyConfigured = !!(Deno.env.get("LOVABLE_API_KEY") ?? "").trim();
    const hook7ApikeyConfigured = !!(Deno.env.get("HOOK7_GLOBAL_APIKEY") ?? "").trim();
    const hook7WebhookConfigured = !!(Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
    const hook7PassphraseConfigured =
      (Deno.env.get("HOOK7_INSTANCE_TOKEN_PASSPHRASE") ?? "").trim().length >= 16;
    const { data: ps } = await admin
      .from("platform_settings")
      .select("hook7_base_url")
      .eq("singleton", true)
      .maybeSingle();
    const hook7BaseUrl =
      (ps as any)?.hook7_base_url && String((ps as any).hook7_base_url).length > 0
        ? String((ps as any).hook7_base_url)
        : "https://api.hook7.com.br";
    const supaUrl = (SUPABASE_URL ?? "").replace(/\/+$/, "");
    const webhookUrlMasked = hook7WebhookConfigured && supaUrl
      ? `${supaUrl}/functions/v1/hook7-webhook/****/{company-slug}`
      : null;
    return new Response(JSON.stringify({
      apify: { token_configured: apifyTokenConfigured },
      resend: {
        api_key_configured: resendApiKeyConfigured,
        lovable_api_key_configured: lovableApiKeyConfigured,
      },
      hook7: {
        apikey_configured: hook7ApikeyConfigured,
        webhook_configured: hook7WebhookConfigured,
        passphrase_configured: hook7PassphraseConfigured,
        base_url: hook7BaseUrl,
        webhook_url_masked: webhookUrlMasked,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
