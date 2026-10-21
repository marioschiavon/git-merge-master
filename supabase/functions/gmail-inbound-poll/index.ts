// Lê respostas de leads nas caixas Gmail conectadas (conexão direta com Google).
// Roda por agendamento. Mesmas regras do inbound antigo:
// - só e-mails de leads cadastrados da empresa entram no app;
// - ignora eco da própria caixa, auto-respostas e listas;
// - deduplica por ID do Gmail e Message-ID RFC;
// - cópia recebida por caixa que não conduz a conversa não dispara a IA.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAsAppUser, GATEWAY_BASE_URL } from "../_shared/appUserConnector.ts";
import { getConnectionKeyForUser, GMAIL_SCOPES } from "../_shared/appUserConnections.ts";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";

const WINDOW_MINUTES = 60; // janela sobreposta; a deduplicação evita repetição

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n").trim();
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function findPart(p: any, mime: string): string | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return b64urlDecode(p.body.data);
  for (const c of p.parts ?? []) {
    const r = findPart(c, mime);
    if (r) return r;
  }
  return null;
}

const addrOf = (v: string) => (v.match(/<([^>]+)>/)?.[1] ?? v).toLowerCase().trim();
const addrList = (v: string) => v.split(",").map(addrOf).filter(Boolean);

async function gmail(key: string, path: string) {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL, connectionAPIKey: key, connectorId: "google_mail",
    path, requiredScopes: GMAIL_SCOPES,
  });
  if (!res.ok) throw Object.assign(new Error(`Gmail [${res.status}]: ${await res.text()}`), { status: res.status });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: any[] = [];

  const { data: grants } = await admin
    .from("user_email_grants")
    .select("id, user_id, company_id, email")
    .eq("transport", "gmail").eq("status", "active");

  for (const g of grants ?? []) {
    const stat = { grant: g.email, checked: 0, ingested: 0, errors: 0 };
    summary.push(stat);
    try {
      const key = await getConnectionKeyForUser(g.user_id, "google_mail");
      if (!key) {
        await admin.from("user_email_grants").update({ status: "expired", last_error: "Conexão Gmail ausente" }).eq("id", g.id);
        continue;
      }
      const after = Math.floor((Date.now() - WINDOW_MINUTES * 60_000) / 1000);
      const q = encodeURIComponent(`in:inbox -from:me after:${after}`);
      let list: any;
      try {
        list = await gmail(key, `/gmail/v1/users/me/messages?maxResults=50&q=${q}`);
      } catch (e: any) {
        if (e.status === 401) {
          await admin.from("user_email_grants").update({ status: "expired", last_error: "Acesso ao Gmail precisa ser renovado" }).eq("id", g.id);
        }
        throw e;
      }
      const grantEmail = String(g.email).toLowerCase();

      for (const m of list.messages ?? []) {
        stat.checked++;
        try {
          // Já processado?
          const { data: seen } = await admin.from("messages").select("id")
            .filter("metadata->>gmail_message_id", "eq", m.id).limit(1).maybeSingle();
          if (seen) continue;

          const meta = await gmail(key,
            `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Auto-Submitted&metadataHeaders=List-Id`);
          const h = (n: string) => (meta.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
          const fromEmail = addrOf(h("From"));
          if (!fromEmail || fromEmail === grantEmail) continue;
          if ((meta.labelIds ?? []).includes("SENT")) continue;
          const auto = h("Auto-Submitted");
          if ((auto && auto.toLowerCase() !== "no") || h("List-Id")) continue;

          // Filtro estrito: só leads da empresa
          const { data: lead } = await admin.from("leads").select("id")
            .eq("company_id", g.company_id).ilike("email", fromEmail).limit(1).maybeSingle();
          if (!lead) continue;

          const full = await gmail(key, `/gmail/v1/users/me/messages/${m.id}?format=full`);
          const fh = (n: string) => (full.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
          const plain = findPart(full.payload, "text/plain");
          const html = plain ? null : findPart(full.payload, "text/html");
          const asText = plain ?? (html ? htmlToText(html) : full.snippet ?? "");
          const bodyText = (stripQuotedEmail(asText) || asText).trim();
          if (!bodyText) continue;
          const rfcMessageId = fh("Message-ID").trim() || null;
          const subject = fh("Subject");

          // Conversa de e-mail do lead
          let { data: conv } = await admin.from("conversations").select("id")
            .eq("lead_id", lead.id).eq("channel", "email").limit(1).maybeSingle();
          if (!conv) {
            const { data: nc, error } = await admin.from("conversations")
              .insert({ lead_id: lead.id, company_id: g.company_id, channel: "email" }).select("id").single();
            if (error) throw error;
            conv = nc;
          }
          const conversationId = conv!.id as string;

          if (rfcMessageId) {
            const { data: dup } = await admin.from("messages").select("id")
              .eq("conversation_id", conversationId).eq("rfc_message_id", rfcMessageId).limit(1).maybeSingle();
            if (dup) continue;
          }

          // Cópia para caixa que não conduz a conversa
          const { data: lastOut } = await admin.from("messages").select("metadata")
            .eq("conversation_id", conversationId).eq("direction", "outbound")
            .not("metadata->>grant_id", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
          const ownerGrantId = (lastOut?.metadata as any)?.grant_id ?? null;
          if (ownerGrantId && ownerGrantId !== g.id) {
            const { data: og } = await admin.from("user_email_grants").select("email").eq("id", ownerGrantId).maybeSingle();
            const rcpts = [...addrList(fh("To")), ...addrList(fh("Cc"))];
            if (og?.email && rcpts.includes(String(og.email).toLowerCase())) continue;
          }

          const { data: inserted, error: mErr } = await admin.from("messages").insert({
            conversation_id: conversationId,
            direction: "inbound",
            channel: "email",
            content: bodyText,
            email_provider: "gmail",
            rfc_message_id: rfcMessageId,
            provider_thread_id: full.threadId ?? null,
            metadata: { gmail_message_id: m.id, grant_row_id: g.id, from_email: fromEmail, subject },
          }).select("id").single();
          if (mErr) throw mErr;

          await admin.from("conversations").update({ last_inbound_at: new Date().toISOString() }).eq("id", conversationId);

          const { error: iErr } = await admin.functions.invoke("inbound-webhook", {
            body: {
              source: "email", lead_id: lead.id, conversation_id: conversationId,
              message_id: inserted.id, text: bodyText, from: fromEmail,
              skip_insert: true, provider: "gmail", provider_message_id: m.id,
            },
          });
          if (iErr) console.error("[gmail-poll] inbound-webhook", iErr);
          stat.ingested++;
        } catch (e) {
          stat.errors++;
          console.error("[gmail-poll] message", m.id, (e as Error).message);
        }
      }
      if (stat.errors === 0) await admin.from("user_email_grants").update({ last_error: null }).eq("id", g.id);
    } catch (e) {
      stat.errors++;
      console.error("[gmail-poll] grant", g.email, (e as Error).message);
      await admin.from("user_email_grants").update({ last_error: (e as Error).message.slice(0, 500) }).eq("id", g.id);
    }
  }
  return json({ ok: true, summary });
});
