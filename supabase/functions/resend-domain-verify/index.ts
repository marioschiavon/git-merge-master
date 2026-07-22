import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";
import { ensureInboundWebhook } from "../_shared/ensure-inbound-webhook.ts";

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
      console.warn("verify falhou, buscando status:", (e as Error).message);
    }

    let fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
    const verified = (fresh.status === "verified") || fresh.records?.every?.((r: any) => r.status === "verified");
    const newStatus = verified ? "verified" : (fresh.status === "failed" ? "failed" : "verifying");

    // Tenta habilitar receiving assim que o domínio estiver verificado.
    let receivingEnabled = fresh.capabilities?.receiving === "enabled";
    if (verified && !receivingEnabled) {
      try {
        await resendJson(`/domains/${row.resend_domain_id}`, {
          method: "PATCH",
          body: JSON.stringify({ capabilities: { receiving: "enabled" } }),
        });
        fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
        receivingEnabled = fresh.capabilities?.receiving === "enabled";
      } catch (e) {
        console.warn("falha ao habilitar receiving:", (e as Error).message);
      }
    }

    const freshRecords: any[] = Array.isArray(fresh.records) ? [...fresh.records] : [];
    const existingRecords: any[] = Array.isArray(row.dns_records) ? row.dns_records : [];
    const existingDmarc = existingRecords.find(
      (r: any) => (r?.name || "").toString().toLowerCase().startsWith("_dmarc"),
    );
    if (existingDmarc && !freshRecords.some((r) => (r?.name || "").toString().toLowerCase().startsWith("_dmarc"))) {
      freshRecords.push(existingDmarc);
    }

    const inboundDomain = row.inbound_domain || `inbound.${row.sending_domain}`;
    let inboundDnsRecords: any[] = Array.isArray(row.inbound_dns_records) ? [...row.inbound_dns_records] : [];
    if (receivingEnabled) {
      const inboundRecords = (fresh.records || []).filter((r: any) =>
        (r.type || "").toUpperCase() === "MX" &&
        /inbound-smtp/i.test(r.value || "")
      );
      if (inboundRecords.length > 0) {
        inboundDnsRecords = inboundRecords;
      } else if (inboundDnsRecords.length === 0) {
        inboundDnsRecords = [{
          record: "Inbound",
          name: "inbound",
          type: "MX",
          value: "inbound-smtp.us-east-1.amazonaws.com",
          priority: 10,
          ttl: "Auto",
          status: "pending",
        }];
      }
    }
    const inboundVerified = inboundDnsRecords.length > 0 && inboundDnsRecords.every((r: any) => r.status === "verified");
    const inboundStatus = receivingEnabled && inboundVerified ? "verified" : "pending";

    // Define reply_to padrão para endereço inbound quando não configurado.
    let reply_to = row.reply_to;
    if (!reply_to && inboundDomain) {
      const local = (row.from_email || "").split("@")[0] || "atendimento";
      reply_to = `${local}@${inboundDomain}`;
    }

    const { data: updated } = await admin
      .from("company_email_domains")
      .update({
        status: newStatus,
        dns_records: freshRecords.length ? freshRecords : row.dns_records,
        verified_at: verified ? new Date().toISOString() : null,
        last_error: null,
        inbound_domain: inboundDomain,
        inbound_dns_records: inboundDnsRecords,
        inbound_status: inboundStatus,
        inbound_configured_at: row.inbound_configured_at || new Date().toISOString(),
        reply_to,
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
