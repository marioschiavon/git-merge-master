// Helpers para lidar com mídia (áudio) recebida no webhook Hook7.
//
// O Hook7 (Evolution-Go) entrega o payload da mensagem em `data.Message.*`
// no formato original do WhatsApp. Para áudio, o objeto é `audioMessage` e
// contém URL criptografada + mediaKey. A forma canônica de obter o arquivo
// já desencriptado é chamar o endpoint de download por chave de mensagem.
//
// Como o path exato pode variar entre versões, tentamos alguns endpoints
// conhecidos do Evolution-Go em ordem, todos autenticados com o token da
// instância (mesmo header `apikey` usado no envio em hook7-whatsapp.ts).

import { getHook7BaseUrl, loadInstanceToken } from "./hook7.ts";

export interface AudioRef {
  seconds: number | null;
  mimetype: string | null;
  ptt: boolean;
  file_length: number | null;
  url: string | null;
}

// deno-lint-ignore no-explicit-any
export function extractAudioRef(data: any): AudioRef | null {
  const am = data?.Message?.audioMessage ?? data?.message?.audioMessage;
  if (!am || typeof am !== "object") return null;
  return {
    seconds: typeof am.seconds === "number" ? am.seconds : (typeof am.Seconds === "number" ? am.Seconds : null),
    mimetype: am.mimetype ?? am.Mimetype ?? null,
    ptt: Boolean(am.ptt ?? am.PTT ?? false),
    file_length: typeof am.fileLength === "number" ? am.fileLength : (typeof am.FileLength === "number" ? am.FileLength : null),
    url: typeof am.url === "string" ? am.url : (typeof am.URL === "string" ? am.URL : null),
  };
}

export interface DownloadedMedia {
  base64: string;
  mimetype: string | null;
}

// deno-lint-ignore no-explicit-any
function pickBase64(json: any): string | null {
  if (!json) return null;
  if (typeof json === "string" && json.length > 100) return json;
  const candidates = [
    json.base64,
    json.Base64,
    json.data,
    json.file,
    json.buffer,
    json?.media?.base64,
    json?.message?.base64,
    json?.result?.base64,
    json?.data?.base64,
    json?.data?.message?.base64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 100) return c;
    if (c && typeof c === "object") {
      const nested = pickBase64(c);
      if (nested) return nested;
    }
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function pickMime(json: any, fallback: string | null): string | null {
  if (!json) return fallback;
  return (
    json.mimetype ??
    json.Mimetype ??
    json.mimeType ??
    json?.media?.mimetype ??
    fallback ??
    null
  );
}

function base64PrefixMime(base64: string): string | null {
  const match = base64.match(/^data:([^;]+);base64,/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function audioHeaderInfo(base64: string): { hex: string; ascii: string; magic: string | null } {
  try {
    const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const head = atob(clean.slice(0, 32));
    const bytes = new Uint8Array(head.length);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(bytes).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    let magic: string | null = null;
    if (ascii.startsWith("OggS")) magic = "audio/ogg";
    else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") magic = "audio/wav";
    else if (ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) magic = "audio/mpeg";
    else if (ascii.slice(4, 8) === "ftyp") magic = "audio/mp4";
    else if (ascii.startsWith("fLaC")) magic = "audio/flac";
    return { hex, ascii, magic };
  } catch {
    return { hex: "", ascii: "", magic: null };
  }
}

function sniffAudioMimetype(base64: string, fallback: string | null): string | null {
  const prefixed = base64PrefixMime(base64);
  if (prefixed) return prefixed;
  const { magic } = audioHeaderInfo(base64);
  return magic ?? fallback;
}

function cleanBase64(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
}

function keyFromPayload(providerMessageId: string, rawPayload: any): Record<string, unknown> {
  const info = rawPayload?.Info ?? rawPayload?.info ?? null;
  const key: Record<string, unknown> = { id: providerMessageId };
  const remoteJid = info?.Chat ?? info?.chat ?? info?.Sender ?? info?.sender;
  if (typeof remoteJid === "string" && remoteJid) key.remoteJid = remoteJid;
  if (typeof info?.IsFromMe === "boolean") key.fromMe = info.IsFromMe;
  if (typeof info?.isFromMe === "boolean") key.fromMe = info.isFromMe;
  const participant = info?.Sender ?? info?.sender ?? info?.Participant ?? info?.participant;
  if (typeof participant === "string" && participant && participant !== remoteJid) key.participant = participant;
  return key;
}

function messageFromPayload(rawPayload: any): any | null {
  const msg = rawPayload?.Message ?? rawPayload?.message ?? rawPayload;
  return msg && typeof msg === "object" ? msg : null;
}

function directBase64FromPayload(rawPayload: any): string | null {
  return pickBase64(rawPayload?.Message) ?? pickBase64(rawPayload?.message) ?? pickBase64(rawPayload);
}

function asValidDownloadedMedia(
  base64: string,
  declaredMime: string | null,
  source: string,
  errors: string[],
): DownloadedMedia | null {
  const clean = cleanBase64(base64);
  const hdr = audioHeaderInfo(clean);
  const bytes = base64ByteLength(clean);
  const sniffed = sniffAudioMimetype(clean, declaredMime);
  console.log("[hook7-media] candidato de áudio", {
    source,
    declared_mime: declaredMime,
    sniffed_mime: sniffed,
    magic: hdr.magic,
    header_hex: hdr.hex,
    header_ascii: hdr.ascii,
    bytes,
  });
  if (!hdr.magic) {
    errors.push(`${source} → base64 sem header de áudio decodificado (${bytes} bytes; header=${hdr.ascii || "vazio"})`);
    return null;
  }
  return { base64: clean, mimetype: sniffed };
}

/**
 * Baixa o áudio (base64) associado a `providerMessageId` pela API Hook7.
 * Tenta as variações conhecidas do endpoint até uma retornar 2xx.
 */
export async function downloadHook7Media(
  // deno-lint-ignore no-explicit-any
  admin: any,
  instance: { id: string; external_name: string },
  providerMessageId: string,
  // deno-lint-ignore no-explicit-any
  rawPayload: any,
  audioRef: AudioRef,
): Promise<DownloadedMedia> {
  const token = await loadInstanceToken(admin, instance.id);
  if (!token) throw new Error("Token da instância indisponível");

  const base = await getHook7BaseUrl(admin);
  const instanceName = encodeURIComponent(instance.external_name);
  const key = keyFromPayload(providerMessageId, rawPayload);
  const message = messageFromPayload(rawPayload);
  const fullMessage = message ? { key, message } : null;

  const errors: string[] = [];

  // Quando o Hook7 já entrega `Message.base64`, use esse arquivo primeiro.
  // Se os bytes não tiverem magic header (ex.: mídia criptografada do WhatsApp),
  // rejeitamos e continuamos tentando o endpoint oficial de download.
  const inlineBase64 = directBase64FromPayload(rawPayload);
  if (inlineBase64) {
    const media = asValidDownloadedMedia(inlineBase64, audioRef.mimetype, "payload.Message.base64", errors);
    if (media) return media;
  }

  const attempts: Array<{ url: string; body: unknown }> = [
    ...(fullMessage
      ? [
        {
          url: `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
          body: { message: fullMessage, convertToMp4: false },
        },
      ]
      : []),
    // Áudio nativo do WhatsApp (OGG/Opus). Não reencapsular — o Scribe aceita
    // o container original e reempacotar pode gerar arquivos inválidos.
    {
      url: `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
      body: { message: { key }, convertToMp4: false },
    },
    {
      url: `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
      body: { message: { key: { id: providerMessageId } }, convertToMp4: false },
    },
    {
      url: `${base}/message/getBase64/${instanceName}`,
      body: { message: { key } },
    },
    {
      url: `${base}/media/download/${instanceName}`,
      body: { messageId: providerMessageId },
    },
  ];

  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          apikey: token,
        },
        body: JSON.stringify(a.body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        errors.push(`${a.url} → ${res.status} ${t.slice(0, 120)}`);
        continue;
      }
      // deno-lint-ignore no-explicit-any
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      const b64 = pickBase64(json);
      if (!b64) {
        errors.push(`${a.url} → 2xx sem base64`);
        continue;
      }
      const declaredMime = pickMime(json, audioRef.mimetype);
      const media = asValidDownloadedMedia(b64, declaredMime, a.url, errors);
      if (!media) continue;
      return media;
    } catch (e) {
      errors.push(`${a.url} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Fallback: se o payload trouxer URL direta, tenta baixar (nem sempre funciona
  // porque geralmente a mídia do WhatsApp é criptografada; deixamos como último recurso).
  if (audioRef.url) {
    try {
      const res = await fetch(audioRef.url);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > 512) {
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const media = asValidDownloadedMedia(btoa(bin), audioRef.mimetype, "audioMessage.url", errors);
          if (media) return media;
        }
      }
    } catch { /* ignore */ }
  }

  throw new Error(`Falha ao baixar áudio Hook7: ${errors.join(" | ")}`);
}

export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const pad = (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
  return Math.floor(clean.length * 3 / 4) - pad;
}
