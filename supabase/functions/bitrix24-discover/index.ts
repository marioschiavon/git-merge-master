import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { credsFromIntegration, createBitrixClient, BitrixError } from "../_shared/bitrix.ts";

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
    const categoryId = body?.category_id ?? null;
    if (!companyId) return json({ error: "company_id é obrigatório" }, 400);

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
    const { data: integration } = await admin
      .from("integrations")
      .select("api_domain, api_token, config, status")
      .eq("company_id", companyId)
      .eq("provider", "bitrix24")
      .maybeSingle();

    if (!integration || integration.status !== "active") {
      return json({ error: "Bitrix24 não conectado." }, 400);
    }

    const bitrix = createBitrixClient(credsFromIntegration(integration as never));

    // --- Funis -------------------------------------------------------------
    let categories: Array<{ id: string; name: string }> = [];
    try {
      const res = await bitrix.call<any>("crm.category.list", { entityTypeId: 2 });
      categories = (res?.categories ?? []).map((c: any) => ({
        id: String(c.id),
        name: String(c.name ?? `Funil ${c.id}`),
      }));
    } catch {
      const res = await bitrix.call<any>("crm.dealcategory.list", {});
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      categories = list.map((c: any) => ({
        id: String(c.ID ?? c.id),
        name: String(c.NAME ?? c.name ?? `Funil ${c.ID ?? c.id}`),
      }));
      if (!categories.some((c) => c.id === "0")) {
        categories.unshift({ id: "0", name: "Geral" });
      }
    }

    // --- Etapas do funil escolhido ----------------------------------------
    const selected = categoryId !== null && categoryId !== undefined && categoryId !== ""
      ? String(categoryId)
      : (categories[0]?.id ?? "0");

    let stages: Array<{ id: string; name: string }> = [];
    try {
      const res = await bitrix.call<any>("crm.dealcategory.stage.list", { id: Number(selected) });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      stages = list.map((s: any) => ({
        id: String(s.STATUS_ID ?? s.ID ?? s.id),
        name: String(s.NAME ?? s.name ?? s.STATUS_ID),
      }));
    } catch (err) {
      stages = [];
      console.log("stage.list falhou:", (err as Error).message);
    }

    // --- Fontes ------------------------------------------------------------
    let sources: Array<{ id: string; name: string }> = [];
    try {
      const res = await bitrix.call<any>("crm.status.list", {
        filter: { ENTITY_ID: "SOURCE" },
      });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      sources = list.map((s: any) => ({
        id: String(s.STATUS_ID),
        name: String(s.NAME ?? s.STATUS_ID),
      }));
    } catch (err) {
      console.log("status.list falhou:", (err as Error).message);
    }

    // --- Campos personalizados do negócio ---------------------------------
    let fields: Array<{ code: string; label: string; type: string }> = [];
    try {
      const res = await bitrix.call<any>("crm.deal.fields", {});
      fields = Object.entries(res ?? {})
        .filter(([code]) => code.startsWith("UF_CRM_"))
        .map(([code, def]: [string, any]) => ({
          code,
          label: String(def?.formLabel || def?.title || code),
          type: String(def?.type ?? "string"),
        }));
    } catch (err) {
      console.log("deal.fields falhou:", (err as Error).message);
    }

    return json({
      ok: true,
      portal: integration.api_domain,
      category_id: selected,
      categories,
      stages,
      sources,
      fields,
    });
  } catch (err) {
    if (err instanceof BitrixError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
});
