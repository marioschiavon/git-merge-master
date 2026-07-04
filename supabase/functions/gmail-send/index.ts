import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { gmailPostJson, getConnectorProfile, GmailConnectorNotLinkedError } from "../_shared/gmail-connector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function b64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildRawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  rfcMessageId: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const headers: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`,
    `Message-ID: ${opts.rfcMessageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  const raw = headers.join("\r\n") + "\r\n\r\n" + opts.html;
  return b64url(raw);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      to, subject, html, text, lead_id, conversation_id,
      in_reply_to_rfc_id, references, gmail_thread_id,
      company_id, extra_metadata,
    } = body ?? {};

    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios: to, subject, html|text" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve company_id (used only for persistence, not for auth)
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

    // Resolve sender from the connector-linked account
    let fromEmail: string;
    try {
      const profile = await getConnectorProfile();
      if (!profile.email) throw new Error("Perfil Gmail sem emailAddress");
      fromEmail = profile.email;
    } catch (err) {
      if (err instanceof GmailConnectorNotLinkedError) {
        return new Response(JSON.stringify({ error: "Gmail connector não conectado no workspace" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    const finalHtml = html || `<p>${escapeHtml(text)}</p>`;
    const rfcMessageId = `<${crypto.randomUUID()}@lovable-sdr>`;

    const raw = buildRawEmail({
      from: fromEmail,
      to,
      subject,
      html: finalHtml,
      rfcMessageId,
      inReplyTo: in_reply_to_rfc_id || null,
      references: references || in_reply_to_rfc_id || null,
    });

    const sendRes = await gmailPostJson(
      "/users/me/messages/send",
      gmail_thread_id ? { raw, threadId: gmail_thread_id } : { raw },
    );

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Gmail connector send error:", sendRes.status, errText);
      return new Response(JSON.stringify({ error: `Gmail API ${sendRes.status}`, details: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sendData = await sendRes.json();
    const gmailMessageId = sendData.id;
    const gmailThreadId = sendData.threadId;

    // Persist outbound message
    let conversationId = conversation_id;
    if (!conversationId && lead_id && companyId) {
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
        gmail_message_id: gmailMessageId,
        gmail_thread_id: gmailThreadId,
        rfc_message_id: rfcMessageId,
        metadata: {
          subject, channel: "email", via: "gmail_connector",
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
        gmail_message_id: gmailMessageId,
        gmail_thread_id: gmailThreadId,
        rfc_message_id: rfcMessageId,
        conversation_id: conversationId,
        from: fromEmail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("gmail-send exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
