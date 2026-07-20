// Cron background: revalida domínios Resend em pending/verifying.
// - Roda de hora em hora via pg_cron.
// - Só considera domínios atualizados nos últimos 7 dias.
// - Se ficar >72h em verifying sem sucesso, grava last_error orientando o usuário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";

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
    const { data: rows, error } = await admin
      .from("company_email_domains")
      .select("*")
      .in("status", ["pending", "verifying"])
      .not("resend_domain_id", "is", null)
      .gte("updated_at", cutoff);

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

        const fresh = await resendJson<any>(`/domains/${row.resend_domain_id}`);
        const verified = fresh.status === "verified" ||
          fresh.records?.every?.((r: any) => r.status === "verified");
        const newStatus = verified
          ? "verified"
          : (fresh.status === "failed" ? "failed" : "verifying");

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
            dns_records: fresh.records || row.dns_records,
            verified_at: verified ? new Date().toISOString() : row.verified_at,
            last_error: lastError,
          })
          .eq("id", row.id);

        results.push({ domain: row.sending_domain, status: newStatus, verified });
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
