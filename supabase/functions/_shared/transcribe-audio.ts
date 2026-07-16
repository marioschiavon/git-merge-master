// Transcreve áudio (formato do WhatsApp/Hook7 — OGG/Opus) usando ElevenLabs
// Scribe. A chave master é gerenciada pelo painel do master (platform_settings)
// e o modelo padrão é `scribe_v2`.
//
// Chamada idêntica ao curl da doc oficial: só `file` + `model_id`. Sem
// fallback: qualquer erro do ElevenLabs propaga (o corpo completo é logado
// para diagnóstico).

import {
  resolveElevenLabsKey,
  elevenLabsFetchWithKey,
  getElevenLabsModel,
  ElevenLabsNotConfiguredError,
} from "./elevenlabs-gateway.ts";

export { ElevenLabsNotConfiguredError };

export interface TranscribeInput {
  base64: string;
  mimetype: string | null | undefined;
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

  // Mesmos campos do curl da doc: file + model_id. Sem language_code
  // (Scribe autodetecta), sem tag_audio_events, sem diarize.
  const form = new FormData();
  form.append("file", blob, `whatsapp-audio.${ext}`);
  form.append("model_id", modelId);

  const t0 = Date.now();
  const res = await elevenLabsFetchWithKey(apiKey, "/v1/speech-to-text", {
    method: "POST",
    body: form,
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs STT falhou [${res.status}] (modelo=${modelId}; mimetype=${mimetype}; bytes=${bytes}): ${errBody.slice(0, 2000)}`,
    );
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

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  if (!input.base64) throw new Error("Áudio vazio");
  const b64 = cleanBase64(input.base64);
  const bytes = byteLengthFromCleanBase64(b64);
  if (bytes < 512) throw new Error("Áudio muito curto ou corrompido");
  const mimetype = cleanMimetype(input.mimetype);

  return await transcribeWithElevenLabs(b64, mimetype, bytes);
}
