import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { parseWebhookUrl, createBitrixClient, BitrixError } from "../_shared/bitrix.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Não autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const companyId = String(body?.company_id ?? "");
    const webhookUrl = String(body?.webhook_url ?? "");
    if (!companyId || !webhookUrl) {
      return json({ error: "company_id e webhook_url são obrigatórios" }, 400);
    }

    const { requireCompanyMember, HttpError } = await import("../_shared/tenant-auth.ts");
    try {
      await requireCompanyMember(user.id, companyId);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 403;
      return json({ error: (err as Error).message }, status);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Somente administradores conectam/desconectam CRM.
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const roleList = (roles ?? []).map((r) => r.role);
    if (!roleList.includes("master_admin")) {
      const { data: mem } = await admin
        .from("company_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (mem?.role !== "company_admin" && !roleList.includes("company_admin")) {
        return json({ error: "Apenas administradores da empresa podem conectar o Bitrix24." }, 403);
      }
    }

    const creds = parseWebhookUrl(webhookUrl);
    const bitrix = createBitrixClient(creds);
    const profile = await bitrix.call<Record<string, unknown>>("profile");

    const userName = [profile?.NAME, profile?.LAST_NAME].filter(Boolean).join(" ") ||
      String(profile?.EMAIL ?? "") || "Usuário Bitrix24";

    // Preserva mapeamento já existente ao reconectar.
    const { data: existing } = await admin
      .from("integrations")
      .select("config")
      .eq("company_id", companyId)
      .eq("provider", "bitrix24")
      .maybeSingle();

    const prev = (existing?.config ?? {}) as Record<string, unknown>;
    const config = {
      user_id: creds.userId,
      category_id: prev.category_id ?? null,
      stage_created: prev.stage_created ?? null,
      stage_handoff: prev.stage_handoff ?? null,
      source_id: prev.source_id ?? null,
      field_map: prev.field_map ?? {},
    };

    const { error } = await admin
      .from("integrations")
      .upsert(
        {
          company_id: companyId,
          provider: "bitrix24",
          api_token: creds.code,
          api_domain: creds.portal,
          status: "active",
          config,
        },
        { onConflict: "company_id,provider" },
      );
    if (error) return json({ error: error.message }, 500);

    // Nunca devolvemos o token.
    return json({ ok: true, portal: creds.portal, user_name: userName });
  } catch (err) {
    if (err instanceof BitrixError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
});
