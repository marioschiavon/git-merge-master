import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";
import {
  getGmailToken, gmailApiFetch, GmailNotConnectedError,
} from "../_shared/gmail-oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeB64Url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  try { return decodeURIComponent(escape(atob(b64))); } catch { return atob(b64); }
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

async function syncCompany(supabase: any, account: any) {
  const companyId: string = account.company_id;
  const tokenRef = { current: await getGmailToken(supabase, companyId) };

  const j = async (path: string) => {
    const r = await gmailApiFetch(supabase, companyId, path, {}, tokenRef);
    if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
    return r.json();
  };
  const p = async (path: string, body: any) => {
    const r = await gmailApiFetch(supabase, companyId, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, tokenRef);
    if (!r.ok) console.error(`Gmail POST ${path} ${r.status}: ${await r.text()}`);
    return r;
  };

  let messageIds: string[] = [];
  let newHistoryId: string | null = account.last_history_id;

  if (account.last_history_id) {
    try {
      const hist = await j(`/users/me/history?startHistoryId=${account.last_history_id}&historyTypes=messageAdded&labelId=INBOX`);
      if (hist.historyId) newHistoryId = hist.historyId;
      for (const h of hist.history || []) {
        for (const m of h.messagesAdded || []) {
          if (m.message?.id) messageIds.push(m.message.id);
        }
      }
    } catch (err) {
      console.warn(`[company ${companyId}] history expired, listing:`, (err as Error).message);
      const list = await j(`/users/me/messages?q=is:unread newer_than:1d in:inbox&maxResults=25`);
      messageIds = (list.messages || []).map((m: any) => m.id);
    }
  } else {
    const list = await j(`/users/me/messages?q=is:unread newer_than:1d in:inbox&maxResults=25`);
    messageIds = (list.messages || []).map((m: any) => m.id);
  }

  messageIds = [...new Set(messageIds)];

  let processed = 0, skipped = 0, matched = 0;

  for (const mid of messageIds) {
    const { data: existing } = await supabase
      .from("messages").select("id").eq("gmail_message_id", mid).maybeSingle();
    if (existing) { skipped++; continue; }

    let msg: any;
    try {
      msg = await j(`/users/me/messages/${mid}?format=full`);
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

    if (fromEmail && account.email && fromEmail === account.email.toLowerCase()) {
      skipped++;
      continue;
    }

    let conversationId: string | null = null;
    let leadId: string | null = null;
    let convCompanyId: string | null = null;

    const { data: byThread } = await supabase
      .from("messages")
      .select("conversation_id, conversations!inner(lead_id, company_id)")
      .eq("gmail_thread_id", threadId).limit(1).maybeSingle();
    if (byThread) {
      conversationId = byThread.conversation_id;
      leadId = (byThread as any).conversations?.lead_id;
      convCompanyId = (byThread as any).conversations?.company_id;
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
          convCompanyId = (byRef as any).conversations?.company_id;
          break;
        }
      }
    }

    if (!conversationId && fromEmail) {
      // Match lead scoped to THIS company
      const { data: lead } = await supabase
        .from("leads").select("id, company_id")
        .eq("email", fromEmail).eq("company_id", companyId)
        .limit(1).maybeSingle();
      if (lead) {
        leadId = lead.id;
        convCompanyId = lead.company_id;
        const { data: existingConv } = await supabase
          .from("conversations").select("id")
          .eq("lead_id", leadId!).eq("channel", "email")
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (existingConv) conversationId = existingConv.id;
        else {
          const { data: activeEnroll } = await supabase
            .from("cadence_enrollments").select("id")
            .eq("lead_id", leadId!).in("status", ["active", "paused"])
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          const { data: newConv } = await supabase
            .from("conversations")
            .insert({
              lead_id: leadId, company_id: convCompanyId,
              channel: "email", cadence_enrollment_id: activeEnroll?.id || null,
            })
            .select("id").single();
          conversationId = newConv?.id || null;
        }
      }
    }

    if (!conversationId) { skipped++; continue; }
    // Safety: only accept if conversation belongs to same company
    if (convCompanyId && convCompanyId !== companyId) { skipped++; continue; }
    matched++;

    const rawBody = extractBody(msg.payload) || msg.snippet || "";
    const cleanBody = stripQuotedEmail(rawBody).substring(0, 10000);

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      content: cleanBody,
      direction: "inbound",
      ai_suggested: false,
      gmail_message_id: mid,
      gmail_thread_id: threadId,
      rfc_message_id: rfcId,
      metadata: { subject, from: fromEmail, channel: "email", via: "gmail" },
    });

    if (leadId && convCompanyId) {
      await supabase.from("lead_activities").insert({
        company_id: convCompanyId, lead_id: leadId, type: "email",
        description: `📨 Resposta recebida: ${subject}`,
        metadata: { gmail_message_id: mid, from: fromEmail },
      });
    }

    try {
      const { error: aiErr } = await supabase.functions.invoke("inbound-webhook", {
        body: {
          conversation_id: conversationId,
          content: cleanBody,
          channel: "email",
          skip_insert: true,
        },
      });
      if (aiErr) console.error(`inbound-webhook invoke error for msg ${mid}:`, aiErr);
    } catch (err) {
      console.error(`inbound-webhook invoke threw for msg ${mid}:`, err);
    }

    await p(`/users/me/messages/${mid}/modify`, { removeLabelIds: ["UNREAD"] });
    processed++;
  }

  await supabase.from("gmail_account")
    .update({ last_history_id: newHistoryId, last_synced_at: new Date().toISOString() })
    .eq("id", account.id);

  return { company_id: companyId, fetched: messageIds.length, processed, matched, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve target company: from body, or from auth token, or "all" for cron
    let companyIdFilter: string | null = null;
    try {
      const body = await req.json();
      if (body?.company_id) companyIdFilter = body.company_id;
    } catch { /* no body */ }

    if (!companyIdFilter) {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: claims } = await userClient.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (userId) {
          const { data: cid } = await supabase.rpc("get_user_company_id", { _user_id: userId });
          if (cid) companyIdFilter = cid as string;
        }
      }
    }

    let query = supabase.from("gmail_account").select("*").eq("is_active", true);
    if (companyIdFilter) query = query.eq("company_id", companyIdFilter);
    const { data: accounts } = await query;

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ error: "Gmail não conectado" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];
    for (const acc of accounts) {
      try {
        results.push(await syncCompany(supabase, acc));
      } catch (err) {
        if (err instanceof GmailNotConnectedError) {
          results.push({ company_id: acc.company_id, error: "not_connected" });
        } else {
          console.error(`sync failed for company ${acc.company_id}:`, err);
          await supabase.rpc("mark_gmail_error", {
            _company_id: acc.company_id,
            _error: `sync: ${(err as Error).message.slice(0, 300)}`,
          });
          results.push({ company_id: acc.company_id, error: (err as Error).message });
        }
      }
    }

    // Aggregate for single-company invoke compatibility
    if (results.length === 1) {
      return new Response(JSON.stringify({ success: true, ...results[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gmail-sync-inbox exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
