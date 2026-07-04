import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";
import {
  gmailGetJson, gmailPostJson, getConnectorProfile, GmailConnectorNotLinkedError,
} from "../_shared/gmail-connector.ts";

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

async function loadSettings(supabase: any): Promise<{ id: string; metadata: any }> {
  const { data } = await supabase
    .from("platform_settings")
    .select("id, metadata")
    .eq("singleton", true).limit(1).maybeSingle();
  if (data) return { id: data.id, metadata: data.metadata || {} };
  const { data: created } = await supabase
    .from("platform_settings")
    .insert({ singleton: true, metadata: {} })
    .select("id, metadata").single();
  return { id: created!.id, metadata: created!.metadata || {} };
}

async function saveHistoryId(supabase: any, settingsId: string, metadata: any, email: string, historyId: string) {
  const next = {
    ...metadata,
    gmail_connector: {
      ...(metadata?.gmail_connector || {}),
      email,
      history_id: historyId,
      updated_at: new Date().toISOString(),
    },
  };
  await supabase.from("platform_settings").update({ metadata: next }).eq("id", settingsId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Confirm connector + get sender email
    let connectorEmail: string;
    try {
      const p = await getConnectorProfile(true);
      connectorEmail = p.email;
    } catch (err) {
      if (err instanceof GmailConnectorNotLinkedError) {
        return new Response(JSON.stringify({ error: "Gmail connector não conectado" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    const settings = await loadSettings(supabase);
    const prevHistoryId: string | undefined = settings.metadata?.gmail_connector?.history_id;
    const prevEmail: string | undefined = settings.metadata?.gmail_connector?.email;

    let messageIds: string[] = [];
    let newHistoryId: string | undefined = prevHistoryId;

    // If the connected Gmail changed, reset the incremental cursor
    const historyUsable = prevHistoryId && prevEmail === connectorEmail;

    if (historyUsable) {
      try {
        const hist = await gmailGetJson(
          `/users/me/history?startHistoryId=${prevHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
        );
        if (hist.historyId) newHistoryId = String(hist.historyId);
        for (const h of hist.history || []) {
          for (const m of h.messagesAdded || []) {
            if (m.message?.id) messageIds.push(m.message.id);
          }
        }
      } catch (err) {
        console.warn("history expired, falling back to list:", (err as Error).message);
        const list = await gmailGetJson(
          `/users/me/messages?q=${encodeURIComponent("is:unread newer_than:1d in:inbox")}&maxResults=25`,
        );
        messageIds = (list.messages || []).map((m: any) => m.id);
      }
    } else {
      const list = await gmailGetJson(
        `/users/me/messages?q=${encodeURIComponent("is:unread newer_than:1d in:inbox")}&maxResults=25`,
      );
      messageIds = (list.messages || []).map((m: any) => m.id);
    }

    messageIds = [...new Set(messageIds)];
    let processed = 0, skipped = 0, matched = 0, ambiguous = 0;

    for (const mid of messageIds) {
      const { data: existing } = await supabase
        .from("messages").select("id").eq("gmail_message_id", mid).maybeSingle();
      if (existing) { skipped++; continue; }

      let msg: any;
      try {
        msg = await gmailGetJson(`/users/me/messages/${mid}?format=full`);
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

      // Skip our own sends
      if (fromEmail && fromEmail === connectorEmail.toLowerCase()) {
        skipped++;
        continue;
      }

      let conversationId: string | null = null;
      let leadId: string | null = null;
      let convCompanyId: string | null = null;
      let ambiguousMatch = false;

      // 1) Thread match
      const { data: byThread } = await supabase
        .from("messages")
        .select("conversation_id, conversations!inner(lead_id, company_id)")
        .eq("gmail_thread_id", threadId).limit(1).maybeSingle();
      if (byThread) {
        conversationId = byThread.conversation_id;
        leadId = (byThread as any).conversations?.lead_id;
        convCompanyId = (byThread as any).conversations?.company_id;
      }

      // 2) In-Reply-To / References match
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

      // 3) From → lead email (across all companies; shared inbox)
      if (!conversationId && fromEmail) {
        const { data: leads } = await supabase
          .from("leads").select("id, company_id, created_at")
          .eq("email", fromEmail)
          .order("created_at", { ascending: false })
          .limit(5);
        if (leads && leads.length > 0) {
          if (leads.length > 1) {
            const companies = new Set(leads.map((l: any) => l.company_id));
            if (companies.size > 1) {
              ambiguousMatch = true;
              ambiguous++;
            }
          }
          const chosen = leads[0];
          leadId = chosen.id;
          convCompanyId = chosen.company_id;
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
        metadata: {
          subject, from: fromEmail, channel: "email", via: "gmail_connector",
          ambiguous_match: ambiguousMatch || undefined,
        },
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

      const modRes = await gmailPostJson(`/users/me/messages/${mid}/modify`, {
        removeLabelIds: ["UNREAD"],
      });
      if (!modRes.ok) console.error(`modify ${mid} ${modRes.status}: ${await modRes.text()}`);
      processed++;
    }

    if (newHistoryId) {
      await saveHistoryId(supabase, settings.id, settings.metadata, connectorEmail, newHistoryId);
    } else {
      // First run: fetch current mailbox historyId to seed
      try {
        const prof = await getConnectorProfile(true);
        if (prof.historyId) {
          await saveHistoryId(supabase, settings.id, settings.metadata, connectorEmail, prof.historyId);
        }
      } catch (_) { /* ignore */ }
    }

    return new Response(JSON.stringify({
      success: true,
      email: connectorEmail,
      fetched: messageIds.length,
      processed, matched, skipped, ambiguous,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("gmail-sync-inbox exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
