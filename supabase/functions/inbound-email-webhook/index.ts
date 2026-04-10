import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Parse incoming email webhook (supports Mailgun, generic forwarding)
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
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("inbound-email-webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
