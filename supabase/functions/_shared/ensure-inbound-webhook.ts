import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendJson } from "./resend-gateway.ts";

export async function ensureInboundWebhook(): Promise<{ id: string; secret: string }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: ps } = await admin
    .from("platform_settings")
    .select("resend_inbound_webhook_id, resend_inbound_webhook_secret")
    .eq("singleton", true)
    .maybeSingle();

  if (ps?.resend_inbound_webhook_id && ps?.resend_inbound_webhook_secret) {
    return { id: ps.resend_inbound_webhook_id, secret: ps.resend_inbound_webhook_secret };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const webhookUrl = supabaseUrl.replace(/\/$/, "") + "/functions/v1/resend-inbound-webhook";

  const webhook = await resendJson<any>("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      name: "Leaderei Inbound Router",
      url: webhookUrl,
      events: ["email.received"],
    }),
  });

  await admin
    .from("platform_settings")
    .update({
      resend_inbound_webhook_id: webhook.id,
      resend_inbound_webhook_secret: webhook.signing_secret,
      updated_at: new Date().toISOString(),
    })
    .eq("singleton", true);

  return { id: webhook.id, secret: webhook.signing_secret };
}
