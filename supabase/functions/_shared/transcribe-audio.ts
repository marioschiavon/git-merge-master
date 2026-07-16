// Transcreve áudio via Lovable AI Gateway.
//
// Roteamento por formato:
// - OGG/Opus (padrão do WhatsApp) → Gemini via /v1/chat/completions (aceita ogg nativamente).
// - Demais (WAV, MP3, M4A, WebM, FLAC) → openai/gpt-4o-transcribe via /v1/audio/transcriptions.

const STT_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_STT_MODEL = "openai/gpt-4o-transcribe";
const DEFAULT_GEMINI_MODEL = "google/gemini-2.5-flash";

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

function isOggOpus(mime: string | null | undefined): boolean {
  const m = String(mime || "").toLowerCase();
  return m.includes("ogg") || m.includes("opus");
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function cleanBase64(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, "");
}

function mapGatewayError(status: number, body: string): Error {
  if (status === 429) return new Error(`STT rate limit (429): ${body}`);
  if (status === 402) return new Error(`STT créditos esgotados (402): ${body}`);
  return new Error(`STT falhou [${status}]: ${body}`);
}

// Rota Gemini para OGG/Opus (WhatsApp) via chat completions com input_audio.
async function transcribeWithGemini(
  apiKey: string,
  base64: string,
  model: string,
): Promise<{ text: string; latency_ms: number }> {
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcreva este áudio literalmente para texto em português (pt-BR). Responda somente com o texto transcrito, sem comentários, sem prefixos e sem aspas.",
          },
          {
            type: "input_audio",
            input_audio: { data: cleanBase64(base64), format: "ogg" },
          },
        ],
      },
    ],
  };

  const t0 = Date.now();
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw mapGatewayError(res.status, errBody);
  }

  const json = await res.json().catch(() => ({} as any));
  const raw = json?.choices?.[0]?.message?.content;
  let text = "";
  if (typeof raw === "string") {
    text = raw.trim();
  } else if (Array.isArray(raw)) {
    // Alguns providers retornam array de blocos
    text = raw
      .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
      .join("")
      .trim();
  }
  if (!text) throw new Error("STT retornou transcrição vazia");
  return { text, latency_ms };
}

// Rota clássica para formatos suportados por gpt-4o-transcribe.
async function transcribeWithOpenAI(
  apiKey: string,
  base64: string,
  mimetype: string | null | undefined,
  model: string,
): Promise<{ text: string; latency_ms: number }> {
  const bytes = base64ToBytes(base64);
  const ext = extensionFromMimetype(mimetype);
  const mime = mimetype && mimetype.includes("/")
    ? mimetype.split(";")[0].trim()
    : `audio/${ext === "m4a" ? "mp4" : ext}`;

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
  return { text, latency_ms };
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");
  if (!input.base64) throw new Error("Áudio vazio");

  const bytes = base64ToBytes(input.base64);
  if (bytes.byteLength < 512) {
    throw new Error("Áudio muito curto ou corrompido");
  }

  // OGG/Opus (WhatsApp) → Gemini; demais → OpenAI transcribe.
  if (isOggOpus(input.mimetype)) {
    const model = input.model || DEFAULT_GEMINI_MODEL;
    const r = await transcribeWithGemini(apiKey, input.base64, model);
    return { text: r.text, model, latency_ms: r.latency_ms };
  }

  const model = input.model || DEFAULT_STT_MODEL;
  const r = await transcribeWithOpenAI(apiKey, input.base64, input.mimetype, model);
  return { text: r.text, model, latency_ms: r.latency_ms };
}
