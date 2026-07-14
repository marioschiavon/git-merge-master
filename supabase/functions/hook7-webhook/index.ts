// Hook7 webhook receiver.
// Path: /functions/v1/hook7-webhook/{secret}/{company-slug}
// Sempre retorna 200 — Hook7 não deve reenviar por erros nossos.
//
// Aligned com o formato real do Hook7 (Evolution-Go), conforme implantado
// no Leaderei Foundation. Eventos suportados:
//   Message       → grava messages (inbound/outbound) + dispara pipeline IA
//   Receipt       → atualiza status delivered/read do outbound
//   Connected     → hook7_instances.status='connected'
//   PairSuccess   → idem
//   LoggedOut     → disconnected/banned/error
//   SendMessage   → ignorado (Message com IsFromMe:true já cobre)
//   ChatPresence  → ignorado
//   default       → ignorado (log)

import { loadInstanceToken, serviceClient } from "../_shared/hook7.ts";
import { base64ByteLength, downloadHook7Media, extractAudioRef, type AudioRef } from "../_shared/hook7-media.ts";
import { extensionFromMimetype, transcribeAudio } from "../_shared/transcribe-audio.ts";

// deno-lint-ignore no-explicit-any
async function uploadAudioToStorage(
  admin: any,
  companyId: string,
  conversationId: string,
  providerMessageId: string,
  base64: string,
  mimetype: string | null,
): Promise<string | null> {
  try {
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = extensionFromMimetype(mimetype);
    const path = `${companyId}/${conversationId}/${providerMessageId}.${ext}`;
    const contentType = mimetype && mimetype.includes("/") ? mimetype.split(";")[0].trim() : `audio/${ext === "m4a" ? "mp4" : ext}`;
    const { error } = await admin.storage.from("whatsapp-audio").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.warn("[hook7-webhook] falha ao subir áudio para storage:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("[hook7-webhook] exceção ao subir áudio para storage:", String(e));
    return null;
  }
}

function ok200() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stripJid(jid: string | null | undefined): string | null {
  if (!jid || typeof jid !== "string") return null;
  const beforeAt = jid.split("@")[0];
  const beforeColon = beforeAt.split(":")[0];
  const digits = beforeColon.replace(/\D/g, "");
  return digits || null;
}

function isGroupLikeJid(jid: string): boolean {
  if (!jid) return false;
  if (jid === "status@broadcast") return true;
  return /@(g\.us|broadcast|newsletter)$/i.test(jid);
}

function brVariants(d: string): string[] {
  const out = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddi = d.slice(0, 2);
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 8) out.add(`${ddi}${ddd}9${rest}`);
    if (rest.length === 9 && rest.startsWith("9")) out.add(`${ddi}${ddd}${rest.slice(1)}`);
  }
  return Array.from(out);
}

// deno-lint-ignore no-explicit-any
async function findLeadByPhone(admin: any, companyId: string, digits: string): Promise<any | null> {
  const variants = brVariants(digits);
  const { data: leads } = await admin
    .from("leads")
    .select("id, phone, whatsapp, status, enrichment_status")
    .eq("company_id", companyId)
    .or("phone.not.is.null,whatsapp.not.is.null");
  const lead = (leads || []).find((l: any) => {
    const cands = [l.whatsapp, l.phone]
      .filter(Boolean)
      .flatMap((p: string) => brVariants(String(p).replace(/\D/g, "")));
    return cands.some((c) =>
      variants.some((f) => c === f || c.endsWith(f.slice(-10)) || f.endsWith(c.slice(-10))),
    );
  });
  return lead || null;
}

// deno-lint-ignore no-explicit-any
async function handleMessage(admin: any, instance: any, company: any, data: any): Promise<"processed" | "ignored"> {
  const info = data?.Info;
  if (!info) return "ignored";

  const chatJid: string = String(info.Chat || info.Sender || "");
  if (info.IsGroup === true || isGroupLikeJid(chatJid)) {
    console.log("[hook7-webhook] ignored group/broadcast/newsletter", { chatJid });
    return "ignored";
  }

  const externalId: string | null = info.ID ? String(info.ID) : null;
  if (!externalId) return "ignored";

  // Dedup por provider_message_id
  const { data: existing } = await admin
    .from("messages")
    .select("id")
    .eq("provider", "hook7")
    .eq("provider_message_id", externalId)
    .maybeSingle();
  if (existing) return "ignored";

  const isOutbound = info.IsFromMe === true;
  const otherJid = isOutbound ? (info.RecipientAlt || info.Chat) : (info.Sender || info.SenderAlt);
  const otherDigits = stripJid(otherJid);
  if (!otherDigits) return "ignored";

  const text: string | null =
    data?.Message?.conversation ??
    data?.Message?.extendedTextMessage?.text ??
    null;
  if (!text) {
    console.log("[hook7-webhook] message sem texto (mídia?) ignorada", { externalId });
    return "ignored";
  }

  const ts: string = info.Timestamp || new Date().toISOString();
  const pushName: string | null = typeof info.PushName === "string" && info.PushName ? info.PushName : null;
  const phoneFormatted = `+${otherDigits}`;

  // Só processa mensagens de leads já cadastrados.
  const lead = await findLeadByPhone(admin, company.id, otherDigits);
  if (!lead) {
    console.log("[hook7-webhook] ignored: phone não corresponde a nenhum lead", {
      company_id: company.id,
      phone: phoneFormatted,
      external_id: externalId,
    });
    // Evita marcar mensagens não usadas como referência (push_name usado só ao criar lead).
    void pushName;
    return "ignored";
  }

  // Conversation whatsapp para este lead
  let { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("company_id", company.id)
    .eq("lead_id", lead.id)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (!conv) {
    const { data: newConv, error: convErr } = await admin
      .from("conversations")
      .insert({ company_id: company.id, lead_id: lead.id, channel: "whatsapp" })
      .select("id")
      .single();
    if (convErr) {
      console.error("[hook7-webhook] conversation insert failed", { error: convErr.message });
      return "processed";
    }
    conv = newConv;
  }

  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: conv.id,
    content: text,
    channel: "whatsapp",
    direction: isOutbound ? "outbound" : "inbound",
    ai_suggested: false,
    provider: "hook7",
    provider_message_id: externalId,
    sent_at: ts,
    metadata: {
      hook7: {
        instance_id: instance.id,
        info,
        push_name: pushName,
        from: phoneFormatted,
        delivery_status: isOutbound ? "sent" : null,
      },
    },
  });
  if (msgErr) {
    if (!String(msgErr.message || "").toLowerCase().includes("duplicate")) {
      console.error("[hook7-webhook] message insert failed", { error: msgErr.message });
    }
    return "processed";
  }

  // Dispara pipeline apenas para inbound
  if (!isOutbound) {
    const invokeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/inbound-webhook`;
    fetch(invokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        lead_id: lead.id,
        conversation_id: conv.id,
        content: text,
        channel: "whatsapp",
        skip_insert: true,
        provider: "hook7",
        provider_message_id: externalId,
      }),
    }).catch((e) => console.error("[hook7-webhook] inbound forward error:", e));
  }

  return "processed";
}

// deno-lint-ignore no-explicit-any
async function handleReceipt(admin: any, instance: any, data: any, state: any) {
  const status = String(state || data?.Type || "").toLowerCase();
  if (!["read", "delivered"].includes(status)) return;
  const messageIds = data?.MessageIDs;
  if (!Array.isArray(messageIds) || messageIds.length === 0) return;

  const ts: string = data?.Timestamp || new Date().toISOString();

  // Nosso schema não tem coluna dedicada; guardamos em metadata.
  const { data: rows } = await admin
    .from("messages")
    .select("id, metadata")
    .eq("provider", "hook7")
    .eq("direction", "outbound")
    .in("provider_message_id", messageIds.map(String));

  for (const row of rows || []) {
    const meta = (row.metadata && typeof row.metadata === "object") ? row.metadata : {};
    const hook7 = (meta as any).hook7 && typeof (meta as any).hook7 === "object" ? (meta as any).hook7 : {};
    const nextMeta = {
      ...meta,
      hook7: {
        ...hook7,
        delivery_status: status,
        delivery_status_at: ts,
        instance_id: instance.id,
      },
    };
    await admin.from("messages").update({ metadata: nextMeta }).eq("id", row.id);
  }
}

// deno-lint-ignore no-explicit-any
function withinUserDisconnectWindow(instance: any): boolean {
  const t = instance?.user_disconnected_at ? new Date(instance.user_disconnected_at).getTime() : 0;
  return t > 0 && Date.now() - t < 5 * 60 * 1000;
}

// deno-lint-ignore no-explicit-any
async function handleConnected(admin: any, instance: any, data: any) {
  if (withinUserDisconnectWindow(instance)) {
    console.log("[hook7-webhook] ignoring Connected after user_disconnect", { instanceId: instance.id });
    return;
  }
  const phone = stripJid(data?.jid);
  const patch: Record<string, any> = {
    status: "connected",
    last_connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (phone) patch.phone_number = phone;
  if (data?.pushName) patch.connected_profile_name = data.pushName;
  await admin.from("hook7_instances").update(patch).eq("id", instance.id);
}

// deno-lint-ignore no-explicit-any
async function handlePairSuccess(admin: any, instance: any, data: any) {
  if (withinUserDisconnectWindow(instance)) {
    console.log("[hook7-webhook] ignoring PairSuccess after user_disconnect", { instanceId: instance.id });
    return;
  }
  const phone =
    stripJid(data?.jid) || stripJid(data?.JID) || stripJid(data?.ID) || stripJid(data?.id);
  const profileName = data?.pushName ?? data?.PushName ?? data?.businessName ?? null;
  const patch: Record<string, any> = {
    status: "connected",
    last_connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (phone) patch.phone_number = phone;
  if (profileName) patch.connected_profile_name = profileName;
  await admin.from("hook7_instances").update(patch).eq("id", instance.id);
}

// deno-lint-ignore no-explicit-any
async function handleLoggedOut(admin: any, instance: any, data: any) {
  const reason = Number(data?.Reason);
  let newStatus = "disconnected";
  if (reason === 403) newStatus = "banned";
  else if (reason >= 500) newStatus = "error";
  await admin
    .from("hook7_instances")
    .update({
      status: newStatus,
      last_error: reason ? `LoggedOut reason=${reason}` : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", instance.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok200();
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hook7-webhook");
    if (idx < 0 || parts.length < idx + 3) {
      console.warn("[hook7-webhook] bad path", url.pathname);
      return ok200();
    }
    const secret = parts[idx + 1];
    const companySlug = decodeURIComponent(parts[idx + 2]);

    const expected = (Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
    if (!expected) {
      console.error("[hook7-webhook] HOOK7_WEBHOOK_SECRET não configurada");
      return ok200();
    }
    if (secret !== expected) {
      console.warn("[hook7-webhook] secret mismatch", { companySlug });
      return ok200();
    }

    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const event: string | undefined = body?.event;
    const instanceExtId: string | undefined = body?.instanceId;
    const instanceToken: string | undefined = body?.instanceToken;

    if (!event || !instanceExtId || !instanceToken) {
      console.warn("[hook7-webhook] envelope incompleto", { event });
      return ok200();
    }

    const admin = serviceClient();

    const { data: company } = await admin
      .from("companies")
      .select("id, slug")
      .eq("slug", companySlug)
      .maybeSingle();
    if (!company) {
      console.warn("[hook7-webhook] company não encontrada", { companySlug });
      return ok200();
    }

    const { data: instance } = await admin
      .from("hook7_instances")
      .select("id, company_id, archived_at, status, user_disconnected_at")
      .eq("external_id", instanceExtId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (!instance || instance.archived_at) {
      console.warn("[hook7-webhook] instância não encontrada/arquivada", { instanceExtId });
      return ok200();
    }

    try {
      const stored = await loadInstanceToken(admin, instance.id);
      if (stored !== instanceToken) {
        console.warn("[hook7-webhook] token mismatch", { instanceExtId });
        return ok200();
      }
    } catch (e) {
      console.warn("[hook7-webhook] erro lendo token", String(e));
      return ok200();
    }

    let processStatus: "processed" | "ignored" | "failed" = "processed";
    try {
      switch (event) {
        case "Message": {
          const res = await handleMessage(admin, instance, company, body.data);
          processStatus = res;
          break;
        }
        case "Receipt":
          await handleReceipt(admin, instance, body.data, body.state);
          break;
        case "Connected":
          await handleConnected(admin, instance, body.data);
          break;
        case "PairSuccess":
          await handlePairSuccess(admin, instance, body.data);
          break;
        case "LoggedOut":
          await handleLoggedOut(admin, instance, body.data);
          break;
        case "ChatPresence":
        case "SendMessage":
          processStatus = "ignored";
          break;
        default:
          processStatus = "ignored";
          console.log("[hook7-webhook] evento desconhecido", { event });
      }
    } catch (err) {
      processStatus = "failed";
      console.error("[hook7-webhook] handler error", { event, error: String(err) });
    }

    // Auditoria best-effort
    try {
      await admin.from("webhook_events").insert({
        source: "hook7",
        company_id: instance.company_id,
        payload: body,
        process_status: processStatus,
        event_type: event,
      });
    } catch { /* tabela pode não existir — ignora */ }

    return ok200();
  } catch (e) {
    console.error("[hook7-webhook] fatal", String(e));
    return ok200();
  }
});
