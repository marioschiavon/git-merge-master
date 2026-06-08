import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function decodeB64Url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

function extractEmailAddress(header: string): string | null {
  if (!header) return null;
  const m = header.match(/<([^>]+)>/);
  return (m ? m[1] : header).trim().toLowerCase();
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const plain = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeB64Url(plain.body.data);
    const html = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) return decodeB64Url(html.body.data).replace(/<[^>]+>/g, " ").trim();
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

async function gmailFetch(url: string, lovableKey: string, gmailKey: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gmailKey,
    },
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gmailPost(url: string, lovableKey: string, gmailKey: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gmailKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Gmail POST ${url} ${res.status}: ${await res.text()}`);
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
    if (!LOVABLE_API_KEY || !GOOGLE_MAIL_API_KEY) {
      return new Response(JSON.stringify({ error: "Gmail não conectado" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auto-create account row on first run using gmail profile
    let { data: account } = await supabase
      .from("gmail_account")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();

    if (!account) {
      const profile = await gmailFetch(`${GATEWAY_URL}/users/me/profile`, LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY);
      const { data: created } = await supabase
        .from("gmail_account")
        .insert({ email: profile.emailAddress, last_history_id: profile.historyId, is_active: true })
        .select("*").single();
      account = created;
      return new Response(
        JSON.stringify({ success: true, bootstrapped: true, email: profile.emailAddress }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // List new message IDs
    let messageIds: string[] = [];
    let newHistoryId: string | null = account.last_history_id;

    if (account.last_history_id) {
      try {
        const hist = await gmailFetch(
          `${GATEWAY_URL}/users/me/history?startHistoryId=${account.last_history_id}&historyTypes=messageAdded&labelId=INBOX`,
          LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY
        );
        if (hist.historyId) newHistoryId = hist.historyId;
        for (const h of hist.history || []) {
          for (const m of h.messagesAdded || []) {
            if (m.message?.id) messageIds.push(m.message.id);
          }
        }
      } catch (err) {
        console.warn("History expired, falling back to list:", (err as Error).message);
        const list = await gmailFetch(
          `${GATEWAY_URL}/users/me/messages?q=is:unread newer_than:1d in:inbox&maxResults=25`,
          LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY
        );
        messageIds = (list.messages || []).map((m: any) => m.id);
      }
    } else {
      const list = await gmailFetch(
        `${GATEWAY_URL}/users/me/messages?q=is:unread newer_than:1d in:inbox&maxResults=25`,
        LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY
      );
      messageIds = (list.messages || []).map((m: any) => m.id);
    }

    // Deduplicate
    messageIds = [...new Set(messageIds)];

    let processed = 0, skipped = 0, matched = 0;

    for (const mid of messageIds) {
      // Skip if already saved
      const { data: existing } = await supabase
        .from("messages").select("id").eq("gmail_message_id", mid).maybeSingle();
      if (existing) { skipped++; continue; }

      let msg: any;
      try {
        msg = await gmailFetch(`${GATEWAY_URL}/users/me/messages/${mid}?format=full`, LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY);
      } catch (err) {
        console.error(`Failed to fetch message ${mid}:`, err);
        continue;
      }

      const headers: Record<string, string> = {};
      for (const h of msg.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;

      const fromEmail = extractEmailAddress(headers["from"] || "");
      const subject = headers["subject"] || "(sem assunto)";
      const inReplyTo = headers["in-reply-to"] || null;
      const references = headers["references"] || null;
      const rfcId = headers["message-id"] || null;
      const threadId = msg.threadId;

      // Skip messages we sent ourselves (from our account)
      const { data: acc } = await supabase.from("gmail_account").select("email").eq("is_active", true).maybeSingle();
      if (fromEmail && acc?.email && fromEmail === acc.email.toLowerCase()) {
        skipped++;
        continue;
      }

      // Match to existing conversation: by thread, then by In-Reply-To, then by lead email
      let conversationId: string | null = null;
      let leadId: string | null = null;
      let companyId: string | null = null;

      const { data: byThread } = await supabase
        .from("messages")
        .select("conversation_id, conversations!inner(lead_id, company_id)")
        .eq("gmail_thread_id", threadId).limit(1).maybeSingle();
      if (byThread) {
        conversationId = byThread.conversation_id;
        leadId = (byThread as any).conversations?.lead_id;
        companyId = (byThread as any).conversations?.company_id;
      }

      if (!conversationId && inReplyTo) {
        const refIds = (inReplyTo + " " + (references || "")).match(/<[^>]+>/g) || [];
        for (const r of refIds) {
          const { data: byRef } = await supabase
            .from("messages")
            .select("conversation_id, conversations!inner(lead_id, company_id)")
            .eq("rfc_message_id", r).limit(1).maybeSingle();
          if (byRef) {
            conversationId = byRef.conversation_id;
            leadId = (byRef as any).conversations?.lead_id;
            companyId = (byRef as any).conversations?.company_id;
            break;
          }
        }
      }

      if (!conversationId && fromEmail) {
        const { data: lead } = await supabase
          .from("leads").select("id, company_id").eq("email", fromEmail).limit(1).maybeSingle();
        if (lead) {
          leadId = lead.id;
          companyId = lead.company_id;
          const { data: existingConv } = await supabase
            .from("conversations").select("id")
            .eq("lead_id", leadId!).eq("channel", "email").maybeSingle();
          if (existingConv) conversationId = existingConv.id;
          else {
            const { data: newConv } = await supabase
              .from("conversations")
              .insert({ lead_id: leadId, company_id: companyId, channel: "email" })
              .select("id").single();
            conversationId = newConv?.id || null;
          }
        }
      }

      if (!conversationId) { skipped++; continue; }
      matched++;

      const body = extractBody(msg.payload) || msg.snippet || "";

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        content: body.substring(0, 10000),
        direction: "inbound",
        ai_suggested: false,
        gmail_message_id: mid,
        gmail_thread_id: threadId,
        rfc_message_id: rfcId,
        metadata: { subject, from: fromEmail, channel: "email", via: "gmail" },
      });

      if (leadId && companyId) {
        await supabase.from("lead_activities").insert({
          company_id: companyId, lead_id: leadId, type: "email",
          description: `📨 Resposta recebida: ${subject}`,
          metadata: { gmail_message_id: mid, from: fromEmail },
        });
      }

      // Mark as read in Gmail
      await gmailPost(`${GATEWAY_URL}/users/me/messages/${mid}/modify`, LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY, {
        removeLabelIds: ["UNREAD"],
      });

      processed++;
    }

    await supabase
      .from("gmail_account")
      .update({ last_history_id: newHistoryId, last_synced_at: new Date().toISOString() })
      .eq("id", account.id);

    return new Response(
      JSON.stringify({ success: true, fetched: messageIds.length, processed, matched, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("gmail-sync-inbox exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
