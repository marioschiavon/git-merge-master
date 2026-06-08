import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripQuotedText = stripQuotedEmail;

function extractPlainText(raw: string): string {
  // Check for MIME multipart boundary
  const boundaryMatch = raw.match(/--([^\r\n]+)/);
  if (!boundaryMatch) return raw;

  const boundary = boundaryMatch[1];
  const parts = raw.split(`--${boundary}`);

  for (const part of parts) {
    // Look for text/plain part
    if (!part.includes("text/plain")) continue;

    const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(part);

    // Split headers from body (double newline)
    const bodyStart = part.search(/\r?\n\r?\n/);
    if (bodyStart === -1) continue;

    let body = part.slice(bodyStart).trim();
    // Remove trailing boundary marker
    const endBoundary = body.indexOf(`--${boundary}`);
    if (endBoundary !== -1) body = body.slice(0, endBoundary).trim();

    if (isBase64) {
      try {
        const clean = body.replace(/\s/g, "");
        const decoded = atob(clean);
        // Handle UTF-8
        const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
      } catch {
        return body;
      }
    }

    return body;
  }

  // No text/plain found — maybe the whole thing is base64 without MIME structure
  if (/^[A-Za-z0-9+/\s]+=*\s*$/.test(raw.trim())) {
    try {
      const clean = raw.trim().replace(/\s/g, "");
      const decoded = atob(clean);
      const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return raw;
    }
  }

  return raw;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let senderEmail: string | null = null;
    let subject: string | null = null;
    let textBody: string | null = null;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      senderEmail = (formData.get("sender") || formData.get("from") || formData.get("From")) as string;
      subject = (formData.get("subject") || formData.get("Subject")) as string;
      textBody = (formData.get("stripped-text") || formData.get("body-plain") || formData.get("Body")) as string;
    } else {
      const body = await req.json();
      senderEmail = body.sender || body.from || body.From;
      subject = body.subject || body.Subject;
      textBody = body["stripped-text"] || body["body-plain"] || body.body || body.Body || body.content;
    }

    // Extract email from "Name <email>" format
    if (senderEmail) {
      const emailMatch = senderEmail.match(/<([^>]+)>/);
      if (emailMatch) senderEmail = emailMatch[1];
      senderEmail = senderEmail.toLowerCase().trim();
    }

    if (!senderEmail || !textBody) {
      return new Response(JSON.stringify({ error: "sender and body are required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode MIME/base64 content
    textBody = extractPlainText(textBody);

    // Strip quoted text from email replies (Gmail, Outlook, generic)
    textBody = stripQuotedText(textBody);

    // Find lead by email
    const { data: lead } = await supabase
      .from("leads")
      .select("id, name, email, company_name")
      .eq("email", senderEmail)
      .maybeSingle();

    if (!lead) {
      console.log(`No lead found for email: ${senderEmail}`);
      return new Response(JSON.stringify({ success: false, reason: "lead_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward to inbound-webhook for AI processing
    const { data: result, error } = await supabase.functions.invoke("inbound-webhook", {
      body: {
        lead_id: lead.id,
        content: textBody,
        channel: "email",
      },
    });

    if (error) {
      console.error("Error forwarding to inbound-webhook:", error);
      return new Response(JSON.stringify({ error: "Failed to process reply" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("inbound-email-webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
