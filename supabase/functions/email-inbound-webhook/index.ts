// Nylas inbound webhook. Strict lead-only filter:
// - Emails from addresses that are NOT registered leads are dropped silently.
//   They stay in the user's real inbox (Gmail/Outlook) and never enter the app.
// - Only emails from known leads (matched by lower(email) + company_id) create
//   conversations/messages and trigger the SDR pipeline.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchMessage, verifyWebhookSignature } from "../_shared/nylas.ts";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";

function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

Deno.serve(async (req) => {
  // Nylas verification challenge (echo back)
  const url = new URL(req.url);
  const challenge = url.searchParams.get("challenge");
  if (challenge) return new Response(challenge, { status: 200 });

  const raw = await req.text();
  const sig = req.headers.get("x-nylas-signature");
  const ok = await verifyWebhookSignature(raw, sig);
  if (!ok) {
    console.warn("[email-inbound] invalid signature");
    return new Response("invalid signature", { status: 401 });
  }

  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const type: string = payload?.type || "";
  const data = payload?.data?.object || {};
  const grantId: string | undefined = data?.grant_id;

  // We only care about incoming messages.
  if (type !== "message.created" || !grantId) {
    return new Response("ignored", { status: 200 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve grant → company
  const { data: grantRow } = await admin
    .from("user_email_grants")
    .select("id, user_id, company_id, email")
    .eq("grant_id", grantId)
    .maybeSingle();
  if (!grantRow) {
    // Unknown grant — ignore.
    return new Response("unknown grant", { status: 200 });
  }

  // Extract from-email (support both webhook payload shape and enriched fetch)
  let msg: any = data;
  if (!msg?.from || !msg?.subject) {
    const fetched = await fetchMessage(grantId, data.id);
    if (fetched) msg = fetched;
  }
  const fromArr = msg?.from as Array<{ email?: string; name?: string }> | undefined;
  const fromEmailRaw: string | undefined = fromArr?.[0]?.email;
  if (!fromEmailRaw) return new Response("no from", { status: 200 });
  const fromEmail = fromEmailRaw.toLowerCase().trim();

  // Skip auto-replies / bounces even if sender matches a lead.
  const headers: Array<{ name: string; value: string }> = msg?.headers || [];
  const hdr = (n: string) =>
    headers.find((h) => h?.name?.toLowerCase() === n.toLowerCase())?.value || "";
  const autoSubmitted = hdr("Auto-Submitted");
  const listId = hdr("List-Id");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return new Response("auto-submitted ignored", { status: 200 });
  }
  if (listId) {
    return new Response("mailing list ignored", { status: 200 });
  }

  // STRICT lead filter: only process if sender is a known lead of this company.
  const { data: lead } = await admin
    .from("leads")
    .select("id, company_id, name")
    .eq("company_id", grantRow.company_id)
    .ilike("email", fromEmail)
    .maybeSingle();

  if (!lead) {
    // Silently ignore. Nothing written, nothing surfaced in the app.
    // The email still exists in the user's real inbox.
    return new Response("not a lead, ignored", { status: 200 });
  }

  // Upsert conversation
  const { data: existingConv } = await admin
    .from("conversations")
    .select("id")
    .eq("lead_id", lead.id)
    .eq("channel", "email")
    .maybeSingle();

  let conversationId = existingConv?.id as string | undefined;
  if (!conversationId) {
    const { data: newConv, error: cErr } = await admin
      .from("conversations")
      .insert({
        lead_id: lead.id,
        company_id: grantRow.company_id,
        channel: "email",
      })
      .select("id")
      .single();
    if (cErr) {
      console.error("[email-inbound] conv insert failed", cErr);
      return new Response("conv failed", { status: 500 });
    }
    conversationId = newConv.id;
  }

  const subject: string = msg?.subject || "";
  const rawBody: string = msg?.body || msg?.snippet || "";
  // Nylas returns HTML in `body`. Convert to plain text and strip quoted history.
  const asText = /<[a-z][\s\S]*>/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
  const bodyText = stripQuotedEmail(asText) || asText;

  // Dedupe: if this Nylas message was already ingested (webhook retry), skip.
  if (msg?.id) {
    const { data: existingMsg } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .filter("metadata->>nylas_message_id", "eq", String(msg.id))
      .maybeSingle();
    if (existingMsg?.id) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const { data: inserted, error: mErr } = await admin.from("messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    channel: "email",
    content: bodyText,
    email_provider: "nylas",
    metadata: {
      nylas_message_id: msg?.id,
      grant_row_id: grantRow.id,
      from_email: fromEmail,
      subject,
    },
  }).select("id").single();
  if (mErr) {
    console.error("[email-inbound] msg insert failed", mErr);
    return new Response("msg failed", { status: 500 });
  }

  // Update lead activity signals
  await admin
    .from("conversations")
    .update({ last_inbound_at: new Date().toISOString() })
    .eq("id", conversationId);

  // Trigger SDR pipeline so the AI continues the conversation.
  // Pass skip_insert (message already persisted here) and provider info so the
  // downstream dedupe can drop retries.
  try {
    await admin.functions.invoke("inbound-webhook", {
      body: {
        source: "email",
        lead_id: lead.id,
        conversation_id: conversationId,
        message_id: inserted?.id,
        text: bodyText,
        from: fromEmail,
        skip_insert: true,
        provider: "nylas",
        provider_message_id: msg?.id ?? null,
      },
    });
  } catch (e) {
    console.warn("[email-inbound] downstream sdr trigger failed:", (e as Error).message);
  }


  return new Response(JSON.stringify({ ok: true, lead_id: lead.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
