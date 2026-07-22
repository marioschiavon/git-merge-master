// Recebe webhooks email.received do Resend, busca o email completo e roteia
// para a company e lead corretos usando o subdomínio inbound dedicado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson } from "../_shared/resend-gateway.ts";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifySvix(payload: string, headers: Headers, secret: string): Promise<boolean> {
  if (!secret || !secret.startsWith("whsec_")) return false;
  const id = headers.get("svix-id") || headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") || headers.get("webhook-timestamp");
  const signatureHeader = headers.get("svix-signature") || headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) return false;

  let secretBytes: ArrayBuffer;
  try {
    secretBytes = base64ToArrayBuffer(secret.slice(6));
  } catch {
    return false;
  }

  const signedContent = `${id}.${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  const signatures = signatureHeader.split(" ").map((s) => s.trim());
  for (const sig of signatures) {
    if (!sig.startsWith("v1,")) continue;
    const candidate = sig.slice(3);
    if (constantTimeCompare(expected, candidate)) return true;
  }
  return false;
}

function getHeader(headers: Record<string, any>, key: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lowerKey) return headers[k];
  }
  return null;
}

function extractEmail(raw: string): string {
  return raw.toString().toLowerCase().replace(/^.*<|>.*$/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const raw = await req.text();

    // Verifica assinatura Svix (Resend) ou secret legacy.
    let verified = false;
    try {
      const { data: ps } = await admin
        .from("platform_settings")
        .select("resend_inbound_webhook_secret")
        .eq("singleton", true)
        .maybeSingle();
      const secret = ps?.resend_inbound_webhook_secret || Deno.env.get("RESEND_INBOUND_SECRET");
      if (secret) {
        verified = await verifySvix(raw, req.headers, secret);
      }
    } catch (e) {
      console.warn("resend-inbound-webhook verify error:", (e as Error).message);
    }
    if (!verified) {
      const legacy = Deno.env.get("RESEND_INBOUND_SECRET");
      const provided = req.headers.get("x-webhook-secret") || req.headers.get("X-Webhook-Secret");
      if (legacy && provided === legacy) verified = true;
    }
    if (!verified) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = JSON.parse(raw);
    const event = payload?.data ?? payload;
    const emailId = event?.email_id || event?.id;
    if (!emailId) {
      return new Response(JSON.stringify({ error: "email_id ausente" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca o email completo (webhook só envia metadados).
    let full: any;
    try {
      full = await resendJson<any>(`/emails/receiving/${emailId}`);
    } catch (e) {
      console.error("resend-inbound-webhook fetch email failed:", (e as Error).message);
      return new Response(JSON.stringify({ error: "falha ao buscar email" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromEmail = extractEmail(
      typeof full.from === "string" ? full.from : (full.from?.email || full.from?.address || ""),
    );

    const toArr = Array.isArray(full.to) ? full.to : [full.to];
    const toEmail = extractEmail(
      typeof toArr[0] === "string" ? toArr[0] : (toArr[0]?.email || toArr[0]?.address || ""),
    );
    const toDomain = toEmail.split("@")[1];

    if (!fromEmail || !toDomain) {
      return new Response(JSON.stringify({ error: "from/to ausente" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Roteia pela company usando o domínio inbound.
    const { data: companyDomain } = await admin
      .from("company_email_domains")
      .select("company_id, sending_domain")
      .ilike("inbound_domain", toDomain)
      .maybeSingle();

    if (!companyDomain) {
      console.log("inbound sem company para o domínio:", toDomain);
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Casa com lead dentro da company.
    const { data: lead } = await admin
      .from("leads")
      .select("id, company_id")
      .ilike("email", fromEmail)
      .eq("company_id", companyDomain.company_id)
      .maybeSingle();

    if (!lead) {
      console.log("inbound sem lead correspondente:", fromEmail, "company:", companyDomain.company_id);
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subject: string = full.subject || "";
    const bodyText: string = full.text || (full.html ? full.html.replace(/<[^>]+>/g, "") : "");
    const cleanText = stripQuotedEmail(bodyText);

    const headers = full.headers || {};
    const messageId = getHeader(headers, "Message-ID") || full.message_id || null;
    const inReplyTo = getHeader(headers, "In-Reply-To") || null;
    const references = getHeader(headers, "References") || null;

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

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "falha ao criar conversa" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
