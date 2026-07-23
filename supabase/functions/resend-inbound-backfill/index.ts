// Reprocessa domínios Resend antigos para habilitar inbound (subdomínio dedicado).
// Restrito a master_admin. Idempotente.
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

    const { data: isMaster } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "master_admin",
    });
    if (!isMaster) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetCompanyId: string | undefined = body?.company_id;

    let query = admin
      .from("company_email_domains")
      .select("*")
      .not("resend_domain_id", "is", null);
    if (targetCompanyId) query = query.eq("company_id", targetCompanyId);

    const { data: rows, error } = await query;
    if (error) throw error;

    // Garante webhook global (idempotente).
    try {
      await ensureInboundWebhook();
    } catch (e) {
      console.warn("backfill: ensureInboundWebhook falhou:", (e as Error).message);
    }

    const results: any[] = [];
    let updated = 0;

    for (const row of rows ?? []) {
      // Pula se já tem inbound configurado
      if (row.inbound_domain && Array.isArray(row.inbound_dns_records) && row.inbound_dns_records.length > 0) {
        results.push({ domain: row.sending_domain, skipped: "already_configured" });
        continue;
      }

      try {
        // Ativa receiving no Resend (idempotente).
        try {
          await resendJson(`/domains/${row.resend_domain_id}`, {
            method: "PATCH",
            body: JSON.stringify({ capabilities: { receiving: "enabled" } }),
          });
        } catch (e) {
          if (e instanceof ResendNotConfiguredError) throw e;
          console.warn(`backfill: PATCH receiving falhou p/ ${row.sending_domain}:`, (e as Error).message);
        }

        const fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
        const receivingEnabled = fresh.capabilities?.receiving === "enabled";

        const inboundDomain = `inbound.${row.sending_domain}`;
        const inboundRecords = (fresh.records || []).filter((r: any) =>
          (r.type || "").toUpperCase() === "MX" &&
          /inbound-smtp/i.test(r.value || "")
        );
        const inboundDnsRecords = inboundRecords.length > 0 ? inboundRecords : [{
          record: "Inbound",
          name: "inbound",
          type: "MX",
          value: "inbound-smtp.us-east-1.amazonaws.com",
          priority: 10,
          ttl: "Auto",
          status: "pending",
        }];

        let reply_to = row.reply_to;
        if (!reply_to) {
          const local = (row.from_email || "").split("@")[0] || "atendimento";
          reply_to = `${local}@${inboundDomain}`;
        }

        const { error: upErr } = await admin
          .from("company_email_domains")
          .update({
            inbound_domain: inboundDomain,
            inbound_dns_records: inboundDnsRecords,
            inbound_status: "pending",
            inbound_configured_at: new Date().toISOString(),
            reply_to,
            last_error: receivingEnabled ? null : "Resend rejeitou habilitação de inbound; verifique plano.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (upErr) throw upErr;
        updated++;
        results.push({
          domain: row.sending_domain,
          inbound_domain: inboundDomain,
          receiving_enabled: receivingEnabled,
        });
      } catch (e) {
        console.error(`backfill: erro em ${row.sending_domain}:`, (e as Error).message);
        results.push({ domain: row.sending_domain, error: (e as Error).message });
      }
    }

    // Log de auditoria
    try {
      await admin.from("audit_logs").insert({
        actor_user_id: userId,
        event: "resend.inbound_backfill",
        details: { processed: results.length, updated, target_company_id: targetCompanyId ?? null },
      });
    } catch (_) {
      // best-effort
    }

    return json({ ok: true, processed: results.length, updated, results });
  } catch (err) {
    console.error("resend-inbound-backfill:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
