// Envia email outbound via Resend (API direta), multi-tenant.
// Cada company usa seu próprio sending domain (tabela company_email_domains).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveResendKey, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API = "https://api.resend.com";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let resendKey: string;
    try {
      resendKey = (await resolveResendKey()).key;
    } catch (e) {
      if (e instanceof ResendNotConfiguredError) {
        return new Response(JSON.stringify({ error: "Resend não configurado" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      to, subject, html, text, lead_id, conversation_id,
      in_reply_to_rfc_id, references,
      provider_thread_id, gmail_thread_id, // aceita nome antigo por compat
      company_id, extra_metadata,
    } = body ?? {};
    const threadId = provider_thread_id || gmail_thread_id || null;

    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios: to, subject, html|text" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve company_id
    let companyId: string | null = company_id ?? null;
    if (!companyId && conversation_id) {
      const { data: conv } = await supabase
        .from("conversations").select("company_id").eq("id", conversation_id).maybeSingle();
      companyId = conv?.company_id ?? null;
    }
    if (!companyId && lead_id) {
      const { data: lead } = await supabase
        .from("leads").select("company_id").eq("id", lead_id).maybeSingle();
      companyId = lead?.company_id ?? null;
    }
    if (!companyId) {
      return new Response(JSON.stringify({ error: "company_id não resolvido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve sending domain da company
    const { data: domainRow } = await supabase
      .from("company_email_domains")
      .select("sending_domain, from_email, from_name, reply_to, status")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!domainRow || domainRow.status !== "verified" || !domainRow.from_email) {
      return new Response(JSON.stringify({
        error: "Domínio de envio da empresa não configurado ou não verificado",
        code: "no_verified_domain",
      }), { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fromName = domainRow.from_name || "SDR";
    const fromEmail = domainRow.from_email;
    const from = `${fromName} <${fromEmail}>`;

    // Gera text/plain se só veio HTML (spam-fighter: emails só-HTML pontuam mal)
    const stripHtml = (h: string) =>
      h.replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const finalHtml = html || `<p>${escapeHtml(text)}</p>`;
    const finalText = text || stripHtml(finalHtml);
    const rfcMessageId = `<${crypto.randomUUID()}@${domainRow.sending_domain}>`;

    // Get/create unsubscribe token para List-Unsubscribe (Gmail/Yahoo 2024)
    const recipientEmail = String(to).toLowerCase();
    let unsubToken: string | null = null;
    try {
      const { data: existing } = await supabase
        .from("email_unsubscribe_tokens")
        .select("token, used_at")
        .eq("email", recipientEmail)
        .maybeSingle();
      if (existing && !existing.used_at) {
        unsubToken = existing.token;
      } else if (!existing) {
        const newTok = crypto.randomUUID().replace(/-/g, "");
        await supabase
          .from("email_unsubscribe_tokens")
          .upsert(
            { token: newTok, email: recipientEmail },
            { onConflict: "email", ignoreDuplicates: true },
          );
        const { data: reread } = await supabase
          .from("email_unsubscribe_tokens")
          .select("token")
          .eq("email", recipientEmail)
          .maybeSingle();
        unsubToken = reread?.token ?? newTok;
      }
    } catch (e) {
      console.warn("unsubscribe token skip:", (e as Error).message);
    }

    const appUrl = Deno.env.get("APP_URL") || "https://app.leaderei.com.br";
    const unsubUrl = unsubToken ? `${appUrl}/unsubscribe?token=${unsubToken}` : null;
    const unsubMailto = `unsubscribe@${domainRow.sending_domain}`;

    // Envio via Resend
    const headers: Record<string, string> = {};
    if (in_reply_to_rfc_id) headers["In-Reply-To"] = in_reply_to_rfc_id;
    if (references || in_reply_to_rfc_id) headers["References"] = references || in_reply_to_rfc_id;
    headers["Message-ID"] = rfcMessageId;
    // Headers anti-spam (Gmail/Yahoo 2024)
    if (unsubUrl) {
      headers["List-Unsubscribe"] = `<${unsubUrl}>, <mailto:${unsubMailto}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    } else {
      headers["List-Unsubscribe"] = `<mailto:${unsubMailto}>`;
    }
    headers["X-Entity-Ref-ID"] = crypto.randomUUID();

    const resendPayload: Record<string, unknown> = {
      from,
      to: [to],
      subject,
      html: finalHtml,
      text: finalText,
      headers,
    };
    // Reply-To: se vazio, cai no from_email (evita mismatch e sinal ruim)
    resendPayload.reply_to = domainRow.reply_to || fromEmail;

    const resp = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendKey}`,
      },
      body: JSON.stringify(resendPayload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Resend send failed [${resp.status}]: ${errText}`);
      return new Response(JSON.stringify({
        error: "Falha no envio via Resend", status: resp.status, details: errText,
      }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sendData = await resp.json();
    const providerMessageId = sendData.id as string;

    // Persist outbound message
    let conversationId = conversation_id;
    if (!conversationId && lead_id) {
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("channel", "email")
        .maybeSingle();
      if (existing) conversationId = existing.id;
      else {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({ lead_id, company_id: companyId, channel: "email" })
          .select("id").single();
        conversationId = newConv?.id;
      }
    }

    if (conversationId) {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        content: text || finalHtml,
        direction: "outbound",
        ai_suggested: false,
        provider_message_id: providerMessageId,
        provider_thread_id: threadId, // Resend não retorna threadId; reusa o passado
        rfc_message_id: rfcMessageId,
        email_provider: "resend",
        metadata: {
          subject, channel: "email", via: "resend",
          sender_email: fromEmail,
          references: references || in_reply_to_rfc_id || null,
          in_reply_to: in_reply_to_rfc_id || null,
          ...(extra_metadata && typeof extra_metadata === "object" ? extra_metadata : {}),
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        provider_message_id: providerMessageId,
        // aliases legados para compat com callers antigos
        gmail_message_id: providerMessageId,
        provider_thread_id: threadId,
        rfc_message_id: rfcMessageId,
        conversation_id: conversationId,
        from: fromEmail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-outbound-email exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
