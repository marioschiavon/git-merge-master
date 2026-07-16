// Transcreve áudio (formato do WhatsApp/Hook7 — OGG/Opus) usando ElevenLabs
// Scribe. A chave master é gerenciada pelo painel do master (platform_settings)
// e o modelo padrão é `scribe_v2`.
//
// Fallback: se a chave master não estiver configurada OU se o ElevenLabs falhar
// (5xx / timeout / erro de rede), cai no fluxo antigo (Gemini multimodal via
// Lovable AI Gateway) para não parar o recebimento de mensagens em produção.

import {
  resolveElevenLabsKey,
  elevenLabsFetchWithKey,
  getElevenLabsModel,
  ElevenLabsNotConfiguredError,
} from "./elevenlabs-gateway.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FALLBACK_MODEL = "google/gemini-2.5-flash";

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

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -------- ElevenLabs (padrão em produção) --------

async function transcribeWithElevenLabs(
  b64: string,
  mimetype: string,
  bytes: number,
): Promise<TranscribeResult> {
  const apiKey = await resolveElevenLabsKey();
  const modelId = await getElevenLabsModel();
  const ext = extensionFromMimetype(mimetype);

  const audio = base64ToUint8Array(b64);
  const blob = new Blob([audio], { type: mimetype });

  const form = new FormData();
  form.append("file", blob, `whatsapp-audio.${ext}`);
  form.append("model_id", modelId);
  form.append("language_code", "por");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  const t0 = Date.now();
  const res = await elevenLabsFetchWithKey(apiKey, "/v1/speech-to-text", {
    method: "POST",
    body: form,
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    // 5xx = erro do provedor → deixar cair no fallback via throw com sinal.
    const isServerError = res.status >= 500;
    const err = new Error(
      `ElevenLabs STT falhou [${res.status}] (modelo=${modelId}; mimetype=${mimetype}; bytes=${bytes}): ${errBody.slice(0, 400)}`,
    );
    (err as any).__fallback_eligible = isServerError;
    throw err;
  }

  const json = await res.json().catch(() => ({} as any));
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) {
    throw new Error(
      `ElevenLabs STT retornou transcrição vazia (modelo=${modelId}; mimetype=${mimetype}; bytes=${bytes})`,
    );
  }

  return {
    text,
    model: `elevenlabs/${modelId}`,
    latency_ms,
    input_mimetype: mimetype,
    input_ext: ext,
    transcoded: false,
  };
}

// -------- Fallback: Gemini multimodal via Lovable AI Gateway --------

function formatFromMimetype(mime: string | null | undefined): string {
  const ext = extensionFromMimetype(mime);
  if (ext === "m4a") return "m4a";
  return ext;
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

async function transcribeWithGemini(
  b64: string,
  mimetype: string,
  bytes: number,
  model: string,
): Promise<TranscribeResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada (fallback Gemini indisponível)");

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
            input_audio: { data: b64, format },
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
    throw new Error(
      `Gemini STT (fallback) falhou [${res.status}] (modelo=${model}; formato=${format}; mimetype=${mimetype}; bytes=${bytes}): ${errBody.slice(0, 400)}`,
    );
  }

  const json = await res.json().catch(() => ({} as any));
  const text = normalizeTranscript(extractText(json));
  if (!text) {
    throw new Error(
      `Gemini STT (fallback) retornou transcrição vazia (modelo=${model}; formato=${format}; mimetype=${mimetype}; bytes=${bytes})`,
    );
  }

  return {
    text,
    model,
    latency_ms,
    input_mimetype: mimetype,
    input_ext: extensionFromMimetype(mimetype),
    transcoded: false,
  };
}

// -------- API pública --------

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  if (!input.base64) throw new Error("Áudio vazio");
  const b64 = cleanBase64(input.base64);
  const bytes = byteLengthFromCleanBase64(b64);
  if (bytes < 512) throw new Error("Áudio muito curto ou corrompido");
  const mimetype = cleanMimetype(input.mimetype);

  // 1) Tenta ElevenLabs (chave master gerenciada pelo painel).
  try {
    return await transcribeWithElevenLabs(b64, mimetype, bytes);
  } catch (e) {
    if (e instanceof ElevenLabsNotConfiguredError) {
      console.warn("[transcribe] ElevenLabs não configurado — usando fallback Gemini");
      return await transcribeWithGemini(b64, mimetype, bytes, input.model || FALLBACK_MODEL);
    }
    // Erros 5xx / rede do ElevenLabs → cai no fallback para não travar o webhook.
    if ((e as any)?.__fallback_eligible || (e instanceof TypeError)) {
      console.error("[transcribe] ElevenLabs falhou, tentando fallback Gemini:", (e as Error).message);
      return await transcribeWithGemini(b64, mimetype, bytes, input.model || FALLBACK_MODEL);
    }
    // 4xx (chave inválida, áudio ruim etc.) — propaga o erro real.
    throw e;
  }
}
