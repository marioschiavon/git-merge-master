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
  const candidates = [
    json.base64,
    json.Base64,
    json.data,
    json.file,
    json.buffer,
    json?.media?.base64,
    json?.result?.base64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 100) return c;
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

function sniffAudioMimetype(base64: string, fallback: string | null): string | null {
  const prefixed = base64PrefixMime(base64);
  if (prefixed) return prefixed;

  try {
    const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const head = atob(clean.slice(0, 32));
    const bytes = new Uint8Array(head.length);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);

    const ascii = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
    if (ascii.startsWith("OggS")) return "audio/ogg";
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return "audio/wav";
    if (ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
    if (ascii.slice(4, 8) === "ftyp") return "audio/mp4";
    if (ascii.startsWith("fLaC")) return "audio/flac";
  } catch { /* keep fallback */ }

  return fallback;
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
  rawMessage: any,
  audioRef: AudioRef,
): Promise<DownloadedMedia> {
  const token = await loadInstanceToken(admin, instance.id);
  if (!token) throw new Error("Token da instância indisponível");

  const base = await getHook7BaseUrl(admin);
  const instanceName = encodeURIComponent(instance.external_name);

  const attempts: Array<{ url: string; body: unknown }> = [
    {
      url: `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
      body: { message: { key: { id: providerMessageId } }, convertToMp4: true },
    },
    {
      url: `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
      body: { message: { key: { id: providerMessageId } }, convertToMp4: false },
    },
    {
      url: `${base}/message/getBase64/${instanceName}`,
      body: { message: { key: { id: providerMessageId } } },
    },
    {
      url: `${base}/media/download/${instanceName}`,
      body: { messageId: providerMessageId },
    },
  ];

  const errors: string[] = [];
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
      return { base64: b64, mimetype: sniffAudioMimetype(b64, declaredMime) };
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
          return { base64: btoa(bin), mimetype: sniffAudioMimetype(btoa(bin), audioRef.mimetype) };
        }
      }
    } catch { /* ignore */ }
  }

  void rawMessage;
  throw new Error(`Falha ao baixar áudio Hook7: ${errors.join(" | ")}`);
}

export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const pad = (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
  return Math.floor(clean.length * 3 / 4) - pad;
}
