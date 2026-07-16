// Transcreve áudio via Lovable AI Gateway usando openai/gpt-4o-transcribe.
//
// Áudio do WhatsApp chega como OGG/Opus. O gpt-4o-transcribe rejeita o
// container "ogg" mas aceita "webm" (mesmo codec Opus). Enviamos os bytes
// exatos, apenas renomeando o container para webm, o que evita transcodificação.

const STT_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const DEFAULT_STT_MODEL = "openai/gpt-4o-transcribe";

export interface TranscribeInput {
  base64: string;
  mimetype: string | null | undefined;
  model?: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
  latency_ms: number;
}

export function extensionFromMimetype(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  // OGG/Opus (WhatsApp) → tratamos como webm (mesmo codec Opus, container aceito)
  if (m.includes("ogg") || m.includes("opus")) return "webm";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "webm";
}

function contentTypeForExt(ext: string): string {
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "flac") return "audio/flac";
  return "audio/webm";
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function mapGatewayError(status: number, body: string): Error {
  if (status === 429) return new Error(`STT rate limit (429): ${body}`);
  if (status === 402) return new Error(`STT créditos esgotados (402): ${body}`);
  return new Error(`STT falhou [${status}]: ${body}`);
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");
  if (!input.base64) throw new Error("Áudio vazio");

  const bytes = base64ToBytes(input.base64);
  if (bytes.byteLength < 512) {
    throw new Error("Áudio muito curto ou corrompido");
  }

  const model = input.model || DEFAULT_STT_MODEL;
  const ext = extensionFromMimetype(input.mimetype);
  const mime = contentTypeForExt(ext);

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);

  const t0 = Date.now();
  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw mapGatewayError(res.status, errBody);
  }

  const json = await res.json().catch(() => ({} as any));
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) throw new Error("STT retornou transcrição vazia");
  return { text, model, latency_ms };
}
