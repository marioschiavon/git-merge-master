// Transcreve áudio via Lovable AI Gateway.
// Endpoint: POST https://ai.gateway.lovable.dev/v1/audio/transcriptions
// Modelo padrão: openai/gpt-4o-transcribe (default do knowledge de STT).
//
// Uso (backend / edge function apenas):
//
//   const t = await transcribeAudio({ base64, mimetype });
//   // t.text, t.model, t.latency_ms

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const DEFAULT_MODEL = "openai/gpt-4o-transcribe";

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

// Extensão coerente com o mimetype — o modelo devolve 400 se o nome do
// arquivo não bater com o formato real dos bytes.
export function extensionFromMimetype(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "ogg"; // WhatsApp default
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");
  if (!input.base64) throw new Error("Áudio vazio");

  const model = input.model || DEFAULT_MODEL;
  const bytes = base64ToBytes(input.base64);
  if (bytes.byteLength < 512) {
    throw new Error("Áudio muito curto ou corrompido");
  }
  const ext = extensionFromMimetype(input.mimetype);
  const mime = input.mimetype && input.mimetype.includes("/")
    ? input.mimetype.split(";")[0].trim()
    : `audio/${ext === "m4a" ? "mp4" : ext}`;

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);

  const t0 = Date.now();
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` }, // não setar Content-Type — FormData define o boundary
    body: form,
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error(`STT rate limit (429): ${body}`);
    if (res.status === 402) throw new Error(`STT créditos esgotados (402): ${body}`);
    throw new Error(`STT falhou [${res.status}]: ${body}`);
  }

  const json = await res.json().catch(() => ({} as any));
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) throw new Error("STT retornou transcrição vazia");
  return { text, model, latency_ms };
}
