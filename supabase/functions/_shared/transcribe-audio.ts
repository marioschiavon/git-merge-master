// Transcreve áudio via Lovable AI Gateway (openai/gpt-4o-transcribe).
//
// WhatsApp envia OGG/Opus, que o gpt-4o-transcribe recusa. Decodificamos
// localmente OGG/Opus → PCM Float32 usando `opus-decoder` (WASM puro,
// funciona em Deno edge) e remontamos como WAV 16-bit antes de enviar.

import { OggOpusDecoder } from "npm:opus-decoder@0.7.11";

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
  if (m.includes("ogg") || m.includes("opus")) return "wav"; // decodificamos antes
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "wav";
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

function contentTypeForExt(ext: string): string {
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "flac") return "audio/flac";
  return "audio/wav";
}

function mapGatewayError(status: number, body: string): Error {
  if (status === 429) return new Error(`STT rate limit (429): ${body}`);
  if (status === 402) return new Error(`STT créditos esgotados (402): ${body}`);
  return new Error(`STT falhou [${status}]: ${body}`);
}

// Downmix multi-canal para mono (média) e converte Float32 → Int16 PCM.
function toMonoInt16(channelData: Float32Array[]): Int16Array {
  const channels = channelData.length;
  const frames = channelData[0].length;
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += channelData[c][i];
    let sample = sum / channels;
    if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

// Envolve PCM Int16 mono em cabeçalho RIFF/WAV.
function pcmToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(buffer);
  const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  bytes.set(pcmBytes, 44);
  return bytes;
}

async function decodeOggOpusToWav(bytes: Uint8Array): Promise<Uint8Array> {
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const decoded = await decoder.decodeFile(bytes);
    if (!decoded?.channelData?.length || !decoded.samplesDecoded) {
      throw new Error("Opus decoder retornou 0 samples");
    }
    const pcm = toMonoInt16(decoded.channelData as Float32Array[]);
    return pcmToWav(pcm, decoded.sampleRate || 48000);
  } finally {
    try { decoder.free?.(); } catch { /* noop */ }
  }
}

async function transcribeWav(
  apiKey: string,
  wav: Uint8Array,
  model: string,
): Promise<{ text: string; latency_ms: number }> {
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");

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

async function transcribeRaw(
  apiKey: string,
  bytes: Uint8Array,
  mimetype: string | null | undefined,
  model: string,
): Promise<{ text: string; latency_ms: number }> {
  const ext = extensionFromMimetype(mimetype);
  const mime = mimetype && mimetype.includes("/")
    ? mimetype.split(";")[0].trim()
    : contentTypeForExt(ext);

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

  const model = input.model || DEFAULT_STT_MODEL;

  if (isOggOpus(input.mimetype)) {
    let wav: Uint8Array;
    try {
      wav = await decodeOggOpusToWav(bytes);
    } catch (e: any) {
      throw new Error(`Falha ao decodificar OGG/Opus: ${e?.message || e}`);
    }
    const r = await transcribeWav(apiKey, wav, model);
    return { text: r.text, model, latency_ms: r.latency_ms };
  }

  const r = await transcribeRaw(apiKey, bytes, input.mimetype, model);
  return { text: r.text, model, latency_ms: r.latency_ms };
}
