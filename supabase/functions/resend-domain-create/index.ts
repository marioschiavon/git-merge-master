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

    const body = await req.json().catch(() => ({}));
    const sending_domain: string = (body?.sending_domain || "").toLowerCase().trim();
    const from_name: string = (body?.from_name || "Atendimento").trim();
    const from_local: string = (body?.from_local || "atendimento").trim().toLowerCase();
    const reply_to: string | null = body?.reply_to || null;

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(sending_domain)) {
      return json({ error: "domínio inválido" }, 400);
    }
    if (!/^[a-z0-9._-]+$/.test(from_local)) {
      return json({ error: "from_local inválido" }, 400);
    }

    // Cria domínio no Resend
    let resendDomain: any;
    try {
      resendDomain = await resendJson("/domains", {
        method: "POST",
        body: JSON.stringify({ name: sending_domain, region: "us-east-1" }),
      });
    } catch (e) {
      if (e instanceof ResendNotConfiguredError) return json({ error: e.message }, 503);
      const msg = (e as Error).message;
      // Se já existe no Resend, buscar e reusar
      if (/already exists|domain_already_exists/i.test(msg)) {
        const list = await resendJson<any>("/domains");
        const existing = (list?.data || []).find(
          (d: any) => (d.name || "").toLowerCase() === sending_domain,
        );
        if (!existing) return json({ error: msg }, 502);
        resendDomain = await resendJson(`/domains/${existing.id}`);
      } else if (/plan includes|Upgrade to add more|403/i.test(msg)) {
        return json({
          error:
            "O plano atual do Resend atingiu o limite de domínios. Remova um domínio não utilizado no dashboard do Resend ou faça upgrade do plano para cadastrar mais.",
          code: "resend_plan_limit",
        }, 402);
      } else {
        return json({ error: msg }, 502);
      }
    }

    const resendDomainId = resendDomain.id;
    const dnsRecords: any[] = Array.isArray(resendDomain.records) ? [...resendDomain.records] : [];

    // Injeta DMARC recomendado (Gmail/Yahoo 2024 exigem para bulk senders).
    // Extrai root do sending_domain para publicar em _dmarc.<root> quando for subdomínio.
    const parts = sending_domain.split(".");
    const dmarcName =
      parts.length > 2 ? `_dmarc.${parts.slice(-2).join(".")}` : `_dmarc`;
    const alreadyHasDmarc = dnsRecords.some(
      (r) => (r?.name || "").toString().toLowerCase().startsWith("_dmarc"),
    );
    if (!alreadyHasDmarc) {
      dnsRecords.push({
        record: "DMARC",
        name: dmarcName,
        type: "TXT",
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${parts.slice(-2).join(".")}; fo=1; adkim=r; aspf=r`,
        ttl: "Auto",
        status: "pending_manual",
      });
    }


    const fromEmail = `${from_local}@${sending_domain}`;

    const { data: saved, error: upsertErr } = await admin
      .from("company_email_domains")
      .upsert({
        company_id: companyId as string,
        sending_domain,
        from_name,
        from_email: fromEmail,
        reply_to,
        resend_domain_id: resendDomainId,
        status: "pending",
        dns_records: dnsRecords,
        last_error: null,
      }, { onConflict: "company_id" })
      .select("*")
      .single();

    if (upsertErr) return json({ error: upsertErr.message }, 500);

    return json({ ok: true, domain: saved });
  } catch (err) {
    console.error("resend-domain-create:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
