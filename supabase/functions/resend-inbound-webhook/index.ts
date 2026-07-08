// Recebe emails inbound do Resend Inbound e delega ao inbound-email-webhook existente.
// O Resend envia payload JSON com: from, to, subject, text, html, headers, etc.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const secret = Deno.env.get("RESEND_INBOUND_SECRET");
    // Validação opcional: se secret configurado, exigir header X-Webhook-Secret ou svix.
    if (secret) {
      const provided = req.headers.get("x-webhook-secret") || req.headers.get("X-Webhook-Secret");
      if (provided !== secret) {
        // Aceita também via svix (Resend usa svix por padrão) — verificação simples de presença
        const hasSvix = req.headers.get("svix-signature");
        if (!hasSvix) return new Response("unauthorized", { status: 401 });
      }
    }

    const raw = await req.text();
    const payload = JSON.parse(raw);
    // Resend inbound event: { type: "email.received", data: { ... } }
    const data = payload?.data ?? payload;

    const fromEmail: string = (
      typeof data.from === "string" ? data.from : (data.from?.email || data.from?.address || "")
    ).toString().toLowerCase().replace(/^.*<|>.*$/g, "").trim();

    const toArr = Array.isArray(data.to) ? data.to : [data.to];
    const toEmail: string = (
      typeof toArr[0] === "string" ? toArr[0] : (toArr[0]?.email || toArr[0]?.address || "")
    ).toString().toLowerCase().trim();

    const subject: string = data.subject || "";
    const bodyText: string = data.text || data.html?.replace(/<[^>]+>/g, "") || "";
    const cleanText = stripQuotedEmail(bodyText);

    const headers = data.headers || {};
    const messageId = headers["Message-ID"] || headers["message-id"] || data.message_id || null;
    const inReplyTo = headers["In-Reply-To"] || headers["in-reply-to"] || null;
    const references = headers["References"] || headers["references"] || null;

    if (!fromEmail) {
      return new Response(JSON.stringify({ error: "from ausente" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Casa com lead pelo email
    const { data: lead } = await admin
      .from("leads")
      .select("id, company_id")
      .ilike("email", fromEmail)
      .limit(1)
      .maybeSingle();

    if (!lead) {
      console.log("inbound sem lead correspondente:", fromEmail);
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve conversation (channel=email)
    let conversationId: string | null = null;
    const { data: existingConv } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("channel", "email")
      .maybeSingle();
    if (existingConv) conversationId = existingConv.id;
    else {
      const { data: newConv } = await admin
        .from("conversations")
        .insert({ lead_id: lead.id, company_id: lead.company_id, channel: "email" })
        .select("id").single();
      conversationId = newConv?.id ?? null;
    }

    if (!conversationId) return new Response(JSON.stringify({ ok: false }), { status: 500 });

    // Insere inbound message
    const { data: inserted } = await admin.from("messages").insert({
      conversation_id: conversationId,
      content: cleanText || bodyText,
      direction: "inbound",
      rfc_message_id: messageId,
      email_provider: "resend",
      metadata: {
        subject, channel: "email", via: "resend_inbound",
        from: fromEmail, to: toEmail,
        in_reply_to: inReplyTo, references,
      },
    }).select("id").single();

    // Delega ao inbound-webhook para classificação/ações downstream
    try {
      await admin.functions.invoke("inbound-webhook", {
        body: {
          source: "email",
          lead_id: lead.id,
          conversation_id: conversationId,
          message_id: inserted?.id,
          text: cleanText || bodyText,
          from: fromEmail,
        },
      });
    } catch (e) {
      console.warn("inbound-webhook downstream falhou:", (e as Error).message);
    }

    return new Response(JSON.stringify({ ok: true, matched: true, lead_id: lead.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("resend-inbound-webhook:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
