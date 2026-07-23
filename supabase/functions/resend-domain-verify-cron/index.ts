// Cron background: revalida domínios Resend em pending/verifying e tenta habilitar receiving.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";
import { ensureInboundWebhook } from "../_shared/ensure-inbound-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const GIVEUP_MS = 72 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    // Processa: pendentes recentes OU já verificados sem inbound configurado (backfill automático).
    const { data: rows, error } = await admin
      .from("company_email_domains")
      .select("*")
      .not("resend_domain_id", "is", null)
      .or(`and(status.in.(pending,verifying),updated_at.gte.${cutoff}),and(status.eq.verified,inbound_domain.is.null)`);

    if (error) throw error;

    const results: any[] = [];

    for (const row of rows ?? []) {
      try {
        try {
          await resendJson(`/domains/${row.resend_domain_id}/verify`, { method: "POST" });
        } catch (e) {
          if (e instanceof ResendNotConfiguredError) throw e;
          console.warn(`[cron] verify falhou p/ ${row.sending_domain}:`, (e as Error).message);
        }

        let fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
        const verified = fresh.status === "verified" ||
          fresh.records?.every?.((r: any) => r.status === "verified");
        const newStatus = verified
          ? "verified"
          : (fresh.status === "failed" ? "failed" : "verifying");

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
            console.warn(`[cron] falha ao habilitar receiving p/ ${row.sending_domain}:`, (e as Error).message);
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

        let reply_to = row.reply_to;
        if (!reply_to && inboundDomain) {
          const local = (row.from_email || "").split("@")[0] || "atendimento";
          reply_to = `${local}@${inboundDomain}`;
        }

        const createdMs = row.created_at ? Date.parse(row.created_at) : Date.now();
        const ageMs = Date.now() - createdMs;
        let lastError: string | null = null;
        if (!verified && newStatus === "verifying" && ageMs > GIVEUP_MS) {
          lastError =
            "DNS publicado mas o Resend ainda não confirmou após 72h. Tente remover e cadastrar o domínio novamente.";
        }

        await admin
          .from("company_email_domains")
          .update({
            status: newStatus,
            dns_records: freshRecords.length ? freshRecords : row.dns_records,
            verified_at: verified ? new Date().toISOString() : row.verified_at,
            last_error: lastError,
            inbound_domain: inboundDomain,
            inbound_dns_records: inboundDnsRecords,
            inbound_status: inboundStatus,
            inbound_configured_at: row.inbound_configured_at || new Date().toISOString(),
            reply_to,
          })
          .eq("id", row.id);

        try {
          await ensureInboundWebhook();
        } catch (e) {
          console.warn(`[cron] falha ao garantir webhook inbound p/ ${row.sending_domain}:`, (e as Error).message);
        }

        results.push({ domain: row.sending_domain, status: newStatus, verified, inbound_status: inboundStatus });
      } catch (e) {
        console.error(`[cron] erro em ${row.sending_domain}:`, (e as Error).message);
        results.push({ domain: row.sending_domain, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("resend-domain-verify-cron:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
