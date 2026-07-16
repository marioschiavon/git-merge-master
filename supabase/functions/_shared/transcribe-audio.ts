// Transcreve áudio do WhatsApp via Lovable AI Gateway usando Gemini multimodal.
//
// Motivo: o endpoint dedicado `/audio/transcriptions` rejeitou OGG/Opus vindo do
// WhatsApp/Hook7 como "Audio file might be corrupted or unsupported". Para esse
// fluxo, enviamos o áudio como input multimodal para um modelo Gemini que aceita
// áudio diretamente.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

export interface TranscribeInput {
  base64: string;
  mimetype: string | null | undefined;
  model?: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
  latency_ms: number;
  input_mimetype: string;
  input_ext: string;
  transcoded: boolean;
}

export function extensionFromMimetype(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

function formatFromMimetype(mime: string | null | undefined): string {
  const ext = extensionFromMimetype(mime);
  if (ext === "m4a") return "m4a";
  return ext;
}

function cleanMimetype(mimetype: string | null | undefined): string {
  const raw = String(mimetype || "").trim();
  if (raw.includes("/")) return raw.split(";")[0].trim().toLowerCase();
  return `audio/${extensionFromMimetype(raw)}`;
}

function cleanBase64(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
}

function byteLengthFromCleanBase64(base64: string): number {
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - pad;
}

function extractText(json: any): string {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .join("")
      .trim();
  }
  return "";
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .replace(/^transcrição\s*:\s*/i, "")
    .trim();
}

function mapGatewayError(status: number, body: string, model: string, mimetype: string, format: string, bytes: number): Error {
  const context = `modelo=${model}; formato=${format}; mimetype=${mimetype}; bytes=${bytes}`;
  if (status === 429) return new Error(`Gemini STT rate limit (429) (${context}): ${body}`);
  if (status === 402) return new Error(`Gemini STT créditos esgotados (402) (${context}): ${body}`);
  return new Error(`Gemini STT falhou [${status}] (${context}): ${body}`);
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");
  if (!input.base64) throw new Error("Áudio vazio");

  const b64 = cleanBase64(input.base64);
  const bytes = byteLengthFromCleanBase64(b64);
  if (bytes < 512) throw new Error("Áudio muito curto ou corrompido");

  const model = input.model || DEFAULT_TRANSCRIPTION_MODEL;
  const mimetype = cleanMimetype(input.mimetype);
  const format = formatFromMimetype(mimetype);

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Você é um transcritor de áudio. Transcreva fielmente o áudio recebido. " +
          "Responda somente com a transcrição, sem comentários, sem markdown e sem tradução.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcreva este áudio de WhatsApp em português do Brasil. Se houver ruído, transcreva apenas o que for inteligível.",
          },
          {
            type: "input_audio",
            input_audio: {
              data: b64,
              format,
            },
          },
        ],
      },
    ],
    temperature: 0,
  };

  const t0 = Date.now();
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "edge-fetch",
    },
    body: JSON.stringify(body),
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw mapGatewayError(res.status, errBody, model, mimetype, format, bytes);
  }

  const json = await res.json().catch(() => ({} as any));
  const text = normalizeTranscript(extractText(json));
  if (!text) throw new Error(`Gemini STT retornou transcrição vazia (modelo=${model}; formato=${format}; mimetype=${mimetype}; bytes=${bytes})`);

  return {
    text,
    model,
    latency_ms,
    input_mimetype: mimetype,
    input_ext: extensionFromMimetype(mimetype),
    transcoded: false,
  };
}