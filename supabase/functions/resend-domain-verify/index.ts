import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: companyId } = await admin.rpc("get_user_company_id", { _user_id: userId });
    if (!companyId) return json({ error: "sem company" }, 400);

    const { data: row } = await admin
      .from("company_email_domains")
      .select("*")
      .eq("company_id", companyId as string)
      .maybeSingle();

    if (!row?.resend_domain_id) return json({ error: "domínio não configurado" }, 404);

    try {
      await resendJson(`/domains/${row.resend_domain_id}/verify`, { method: "POST" });
    } catch (e) {
      if (e instanceof ResendNotConfiguredError) return json({ error: e.message }, 503);
      // segue mesmo com erro — busca status atualizado abaixo
      console.warn("verify falhou, buscando status:", (e as Error).message);
    }

    const fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
    const verified = (fresh.status === "verified") || fresh.records?.every?.((r: any) => r.status === "verified");
    const newStatus = verified ? "verified" : (fresh.status === "failed" ? "failed" : "verifying");

    // Preserva a linha DMARC (Resend não retorna, mas queremos manter no registro para UI)
    const freshRecords: any[] = Array.isArray(fresh.records) ? [...fresh.records] : [];
    const existingRecords: any[] = Array.isArray(row.dns_records) ? row.dns_records : [];
    const existingDmarc = existingRecords.find(
      (r: any) => (r?.name || "").toString().toLowerCase().startsWith("_dmarc"),
    );
    if (existingDmarc && !freshRecords.some((r) => (r?.name || "").toString().toLowerCase().startsWith("_dmarc"))) {
      freshRecords.push(existingDmarc);
    }

    const { data: updated } = await admin
      .from("company_email_domains")
      .update({
        status: newStatus,
        dns_records: freshRecords.length ? freshRecords : row.dns_records,
        verified_at: verified ? new Date().toISOString() : null,
        last_error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();

    return json({ ok: true, domain: updated });
  } catch (err) {
    console.error("resend-domain-verify:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
