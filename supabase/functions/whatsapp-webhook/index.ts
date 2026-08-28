// Receptor de eventos do WhatsApp (padrão atual do provedor).
// Path: /functions/v1/whatsapp-webhook/{secret}/{company-slug}
// Sempre retorna 200 — o provedor não deve reenviar por erros nossos.
//
// Eventos tratados:
//   messages.upsert     → grava messages (inbound/outbound) + pipeline IA
//   messages.update     → status delivered/read do outbound
//   connection.update   → status da conexão (open/connecting/close)
//   qrcode.updated      → marca qr_ready
//   send.message        → ignorado (messages.upsert com fromMe já cobre)

import { serviceClient } from "../_shared/hook7.ts";
import {
  base64ByteLength,
  downloadHook7Media,
  extractAudioRef,
  type AudioRef,
} from "../_shared/hook7-media.ts";

function ok200() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function audioExtensionFromMimetype(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "wav";
}

async function transcribeInboundAudio(base64: string, mimetype: string | null | undefined) {
  const mod = await import("../_shared/transcribe-audio.ts");
  return mod.transcribeAudio({ base64, mimetype });
}

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
    const ext = audioExtensionFromMimetype(mimetype);
    const path = `${companyId}/${conversationId}/${providerMessageId}.${ext}`;
    const contentType = mimetype && mimetype.includes("/")
      ? mimetype.split(";")[0].trim()
      : `audio/${ext === "m4a" ? "mp4" : ext}`;
    const { error } = await admin.storage.from("whatsapp-audio").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.warn("[whatsapp-webhook] falha ao subir áudio:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("[whatsapp-webhook] exceção ao subir áudio:", String(e));
    return null;
  }
}

function stripJid(jid: string | null | undefined): string | null {
  if (!jid || typeof jid !== "string") return null;
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
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
  // deno-lint-ignore no-explicit-any
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
function extractText(message: any): string | null {
  if (!message || typeof message !== "object") return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    message.templateButtonReplyMessage?.selectedDisplayText ??
    null
  );
}

function tsToIso(v: unknown): string {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  return new Date().toISOString();
}

// deno-lint-ignore no-explicit-any
async function handleMessage(admin: any, instance: any, company: any, data: any): Promise<"processed" | "ignored"> {
  const key = data?.key;
  if (!key) return "ignored";

  const remoteJid = String(key.remoteJid || "");
  if (isGroupLikeJid(remoteJid)) {
    console.log("[whatsapp-webhook] grupo/broadcast ignorado", { remoteJid });
    return "ignored";
  }

  const externalId: string | null = key.id ? String(key.id) : null;
  if (!externalId) return "ignored";

  const { data: existing } = await admin
    .from("messages")
    .select("id")
    .eq("provider", "hook7")
    .eq("provider_message_id", externalId)
    .maybeSingle();
  if (existing) return "ignored";

  const isOutbound = key.fromMe === true;
  const otherDigits = stripJid(remoteJid);
  if (!otherDigits) return "ignored";

  let text: string | null = extractText(data?.message);

  let audioMeta: Record<string, unknown> | null = null;
  let transcriptionFailed = false;
  if (!text) {
    const audioRef: AudioRef | null = extractAudioRef(data);
    if (!audioRef) {
      console.log("[whatsapp-webhook] mensagem sem texto/áudio ignorada", { externalId });
      return "ignored";
    }
    if (isOutbound) {
      console.log("[whatsapp-webhook] áudio outbound ignorado", { externalId });
      return "ignored";
    }
    try {
      const media = await downloadHook7Media(admin, instance, externalId, data, audioRef);
      const bytes = base64ByteLength(media.base64);
      try {
        const stt = await transcribeInboundAudio(media.base64, media.mimetype);
        text = stt.text;
        audioMeta = {
          seconds: audioRef.seconds,
          mimetype: media.mimetype ?? audioRef.mimetype,
          ptt: audioRef.ptt,
          file_length: audioRef.file_length ?? bytes,
          transcript_model: stt.model,
          transcript_latency_ms: stt.latency_ms,
          transcript_input_mimetype: stt.input_mimetype,
          transcript_input_ext: stt.input_ext,
          transcript_transcoded: stt.transcoded,
        };
      } catch (sttErr) {
        transcriptionFailed = true;
        text = "[áudio não transcrito]";
        audioMeta = {
          seconds: audioRef.seconds,
          mimetype: media.mimetype ?? audioRef.mimetype,
          ptt: audioRef.ptt,
          file_length: audioRef.file_length ?? bytes,
          transcript_error: sttErr instanceof Error ? sttErr.message : String(sttErr),
        };
        console.error("[whatsapp-webhook] transcrição falhou", { externalId });
      }
      // deno-lint-ignore no-explicit-any
      (audioMeta as any).__pending_base64 = media.base64;
      // deno-lint-ignore no-explicit-any
      (audioMeta as any).__pending_mime = media.mimetype;
    } catch (dlErr) {
      transcriptionFailed = true;
      text = "[áudio não transcrito]";
      audioMeta = {
        seconds: audioRef.seconds,
        mimetype: audioRef.mimetype,
        ptt: audioRef.ptt,
        file_length: audioRef.file_length,
        download_error: dlErr instanceof Error ? dlErr.message : String(dlErr),
      };
      console.error("[whatsapp-webhook] download de áudio falhou", { externalId });
    }
  }

  const ts = tsToIso(data?.messageTimestamp);
  const pushName: string | null = typeof data?.pushName === "string" && data.pushName
    ? data.pushName
    : null;
  const phoneFormatted = `+${otherDigits}`;

  const lead = await findLeadByPhone(admin, company.id, otherDigits);
  if (!lead) {
    console.log("[whatsapp-webhook] telefone sem lead cadastrado — ignorado", {
      company_id: company.id,
      phone: phoneFormatted,
      external_id: externalId,
    });
    return "ignored";
  }

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
      console.error("[whatsapp-webhook] conversation insert failed", { error: convErr.message });
      return "processed";
    }
    conv = newConv;
  }

  let pendingAudioB64: string | null = null;
  let pendingAudioMime: string | null = null;
  // deno-lint-ignore no-explicit-any
  if (audioMeta && (audioMeta as any).__pending_base64) {
    // deno-lint-ignore no-explicit-any
    pendingAudioB64 = (audioMeta as any).__pending_base64 as string;
    // deno-lint-ignore no-explicit-any
    pendingAudioMime = ((audioMeta as any).__pending_mime as string | null) ?? null;
    // deno-lint-ignore no-explicit-any
    delete (audioMeta as any).__pending_base64;
    // deno-lint-ignore no-explicit-any
    delete (audioMeta as any).__pending_mime;
  }

  const baseMeta = {
    instance_id: instance.id,
    key,
    message_type: data?.messageType ?? null,
    push_name: pushName,
    from: phoneFormatted,
    delivery_status: isOutbound ? "sent" : null,
  };

  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: conv.id,
    content: text,
    channel: "whatsapp",
    direction: isOutbound ? "outbound" : "inbound",
    ai_suggested: false,
    provider: "hook7",
    provider_message_id: externalId,
    sent_at: ts,
    metadata: { hook7: { ...baseMeta, ...(audioMeta ? { audio: audioMeta } : {}) } },
  });
  if (msgErr) {
    if (!String(msgErr.message || "").toLowerCase().includes("duplicate")) {
      console.error("[whatsapp-webhook] message insert failed", { error: msgErr.message });
    }
    return "processed";
  }

  if (pendingAudioB64) {
    const storagePath = await uploadAudioToStorage(
      admin, company.id, conv.id, externalId, pendingAudioB64, pendingAudioMime,
    );
    if (storagePath && audioMeta) {
      await admin
        .from("messages")
        .update({
          metadata: {
            hook7: { ...baseMeta, audio: { ...audioMeta, storage_path: storagePath } },
          },
        })
        .eq("provider", "hook7")
        .eq("provider_message_id", externalId);
    }
  }

  if (!isOutbound && !transcriptionFailed) {
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
    }).catch((e) => console.error("[whatsapp-webhook] inbound forward error:", e));
  } else if (!isOutbound && transcriptionFailed) {
    console.log("[whatsapp-webhook] pipeline IA pulado — áudio sem transcrição", { externalId });
  }

  return "processed";
}

// deno-lint-ignore no-explicit-any
async function handleReceipt(admin: any, instance: any, data: any) {
  const rows = Array.isArray(data) ? data : [data];
  for (const r of rows) {
    const raw = String(r?.status ?? r?.update?.status ?? "").toUpperCase();
    const status = raw.includes("READ") || raw === "PLAYED"
      ? "read"
      : raw.includes("DELIVERY") || raw === "DELIVERED"
      ? "delivered"
      : null;
    const msgId = r?.keyId ?? r?.key?.id ?? r?.messageId ?? null;
    if (!status || !msgId) continue;

    const { data: rowsDb } = await admin
      .from("messages")
      .select("id, metadata")
      .eq("provider", "hook7")
      .eq("direction", "outbound")
      .eq("provider_message_id", String(msgId));

    for (const row of rowsDb || []) {
      const meta = (row.metadata && typeof row.metadata === "object") ? row.metadata : {};
      // deno-lint-ignore no-explicit-any
      const h7 = (meta as any).hook7 && typeof (meta as any).hook7 === "object" ? (meta as any).hook7 : {};
      await admin.from("messages").update({
        metadata: {
          ...meta,
          hook7: {
            ...h7,
            delivery_status: status,
            delivery_status_at: new Date().toISOString(),
            instance_id: instance.id,
          },
        },
      }).eq("id", row.id);
    }
  }
}

// deno-lint-ignore no-explicit-any
function withinUserDisconnectWindow(instance: any): boolean {
  const t = instance?.user_disconnected_at ? new Date(instance.user_disconnected_at).getTime() : 0;
  return t > 0 && Date.now() - t < 5 * 60 * 1000;
}

// deno-lint-ignore no-explicit-any
async function handleConnectionUpdate(admin: any, instance: any, data: any) {
  const state = String(data?.state ?? data?.connection ?? "").toLowerCase();
  const nowIso = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = { updated_at: nowIso };

  if (state === "open") {
    if (withinUserDisconnectWindow(instance)) {
      console.log("[whatsapp-webhook] 'open' ignorado após desconexão manual", { id: instance.id });
      return;
    }
    patch.status = "connected";
    patch.last_connected_at = nowIso;
    patch.last_error = null;
    const phone = stripJid(data?.wuid ?? data?.jid ?? data?.instance?.wuid);
    if (phone) patch.phone_number = phone;
    const name = data?.profileName ?? data?.pushName ?? null;
    if (name) patch.connected_profile_name = name;
  } else if (state === "connecting") {
    patch.status = "pairing";
  } else if (state === "close") {
    const reason = Number(data?.statusReason ?? data?.reason ?? 0);
    patch.status = reason === 403 ? "banned" : reason >= 500 ? "error" : "disconnected";
    if (reason) patch.last_error = `connection close reason=${reason}`;
  } else {
    return;
  }

  await admin.from("hook7_instances").update(patch).eq("id", instance.id);
}

// deno-lint-ignore no-explicit-any
async function handleQrUpdate(admin: any, instance: any) {
  const nowIso = new Date().toISOString();
  await admin
    .from("hook7_instances")
    .update({ status: "qr_ready", last_qr_at: nowIso, updated_at: nowIso })
    .eq("id", instance.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok200();
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("whatsapp-webhook");
    if (idx < 0 || parts.length < idx + 3) {
      console.warn("[whatsapp-webhook] path inválido", url.pathname);
      return ok200();
    }
    const secret = parts[idx + 1];
    const companySlug = decodeURIComponent(parts[idx + 2]);

    const expected = (Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
    if (!expected) {
      console.error("[whatsapp-webhook] HOOK7_WEBHOOK_SECRET não configurada");
      return ok200();
    }
    if (secret !== expected) {
      console.warn("[whatsapp-webhook] secret inválido", { companySlug });
      return ok200();
    }

    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const event = String(body?.event ?? "").toLowerCase().replace(/_/g, ".");
    const instanceName: string | undefined = body?.instance ?? body?.instanceName;
    if (!event || !instanceName) {
      console.warn("[whatsapp-webhook] envelope incompleto", { event });
      return ok200();
    }

    const admin = serviceClient();

    const { data: company } = await admin
      .from("companies")
      .select("id, slug")
      .eq("slug", companySlug)
      .maybeSingle();
    if (!company) {
      console.warn("[whatsapp-webhook] empresa não encontrada", { companySlug });
      return ok200();
    }

    const { data: instance } = await admin
      .from("hook7_instances")
      .select("id, company_id, external_name, archived_at, status, user_disconnected_at")
      .eq("external_name", instanceName)
      .eq("company_id", company.id)
      .maybeSingle();
    if (!instance || instance.archived_at) {
      console.warn("[whatsapp-webhook] conexão não encontrada/arquivada", { instanceName });
      return ok200();
    }

    let processStatus: "processed" | "ignored" | "failed" = "processed";
    try {
      switch (event) {
        case "messages.upsert": {
          const rows = Array.isArray(body.data) ? body.data : [body.data];
          let any = false;
          for (const d of rows) {
            const r = await handleMessage(admin, instance, company, d);
            if (r === "processed") any = true;
          }
          processStatus = any ? "processed" : "ignored";
          break;
        }
        case "messages.update":
          await handleReceipt(admin, instance, body.data);
          break;
        case "connection.update":
          await handleConnectionUpdate(admin, instance, body.data);
          break;
        case "qrcode.updated":
          await handleQrUpdate(admin, instance);
          break;
        case "send.message":
        case "presence.update":
          processStatus = "ignored";
          break;
        default:
          processStatus = "ignored";
          console.log("[whatsapp-webhook] evento não tratado", { event });
      }
    } catch (err) {
      processStatus = "failed";
      console.error("[whatsapp-webhook] handler error", { event, error: String(err) });
    }

    try {
      await admin.from("webhook_events").insert({
        source: "whatsapp",
        company_id: instance.company_id,
        payload: body,
        process_status: processStatus,
        event_type: event,
      });
    } catch { /* tabela pode não existir */ }

    return ok200();
  } catch (e) {
    console.error("[whatsapp-webhook] fatal", String(e));
    return ok200();
  }
});
