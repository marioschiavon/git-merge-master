// Transcreve áudio via Lovable AI Gateway (openai/gpt-4o-transcribe).
//
// WhatsApp envia OGG/Opus, que o STT costuma rejeitar como arquivo inválido.
// Por isso transcodificamos OGG/Opus para WAV antes de enviar ao Gateway.

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
  input_mimetype: string;
  input_ext: string;
  transcoded: boolean;
}

interface PreparedAudio {
  bytes: Uint8Array;
  mimetype: string;
  ext: string;
  transcoded: boolean;
  source_ext: string;
  warning?: string;
}

export function extensionFromMimetype(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "wav";
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function contentTypeForExt(ext: string): string {
  if (ext === "ogg") return "audio/ogg";
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "flac") return "audio/flac";
  return "audio/wav";
}

function cleanMimetype(mimetype: string | null | undefined, ext: string): string {
  const raw = String(mimetype || "").trim();
  if (raw.includes("/")) return raw.split(";")[0].trim().toLowerCase();
  return contentTypeForExt(ext);
}

function isOggOpus(bytes: Uint8Array, mimetype: string | null | undefined): boolean {
  const mime = String(mimetype || "").toLowerCase();
  const hasOggMagic = bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53;
  return hasOggMagic || mime.includes("ogg") || mime.includes("opus");
}

function pcmToWav(channelData: Float32Array[], sampleRate: number): Uint8Array {
  const channels = channelData.filter((c) => c && c.length > 0);
  if (channels.length === 0) throw new Error("Decoder OGG/Opus retornou áudio vazio");

  const sampleCount = channels[0].length;
  const dataSize = sampleCount * 2;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    let mixed = 0;
    for (const channel of channels) mixed += channel[i] || 0;
    mixed = Math.max(-1, Math.min(1, mixed / channels.length));
    view.setInt16(offset, mixed < 0 ? mixed * 0x8000 : mixed * 0x7fff, true);
    offset += 2;
  }

  return out;
}

async function convertOggOpusToWav(bytes: Uint8Array): Promise<Uint8Array> {
  const { OggOpusDecoder } = await import("npm:ogg-opus-decoder@1.7.3");
  const decoder = new OggOpusDecoder({ sampleRate: 16000 });
  await decoder.ready;
  try {
    const decoded = await decoder.decodeFile(bytes);
    return pcmToWav(decoded.channelData, decoded.sampleRate || 16000);
  } finally {
    decoder.free();
  }
}

async function prepareAudioForStt(bytes: Uint8Array, mimetype: string | null | undefined): Promise<PreparedAudio> {
  const sourceExt = extensionFromMimetype(mimetype);
  if (!isOggOpus(bytes, mimetype)) {
    return {
      bytes,
      mimetype: cleanMimetype(mimetype, sourceExt),
      ext: sourceExt,
      transcoded: false,
      source_ext: sourceExt,
    };
  }

  try {
    const wav = await convertOggOpusToWav(bytes);
    return {
      bytes: wav,
      mimetype: "audio/wav",
      ext: "wav",
      transcoded: true,
      source_ext: sourceExt,
    };
  } catch (e) {
    const warning = e instanceof Error ? e.message : String(e);
    console.warn("[transcribe-audio] conversão OGG/Opus para WAV falhou; tentando bruto", { warning });
    return {
      bytes,
      mimetype: cleanMimetype(mimetype, sourceExt),
      ext: sourceExt,
      transcoded: false,
      source_ext: sourceExt,
      warning,
    };
  }
}

function mapGatewayError(status: number, body: string, audio: PreparedAudio): Error {
  const context = `arquivo=${audio.ext}/${audio.mimetype}; bytes=${audio.bytes.byteLength}; transcoded=${audio.transcoded}${audio.warning ? `; transcode_warning=${audio.warning}` : ""}`;
  if (status === 429) return new Error(`STT rate limit (429) (${context}): ${body}`);
  if (status === 402) return new Error(`STT créditos esgotados (402) (${context}): ${body}`);
  return new Error(`STT falhou [${status}] (${context}): ${body}`);
}

async function transcribeRaw(
  apiKey: string,
  audio: PreparedAudio,
  model: string,
): Promise<{ text: string; latency_ms: number; audio: PreparedAudio }> {
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([audio.bytes], { type: audio.mimetype }), `audio.${audio.ext}`);

  const t0 = Date.now();
  const res = await fetch(STT_URL, {
    method: "POST",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "edge-fetch",
    },
    body: form,
  });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw mapGatewayError(res.status, errBody, audio);
  }

  const json = await res.json().catch(() => ({} as any));
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) throw new Error("STT retornou transcrição vazia");
  return { text, latency_ms, audio };
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

  const prepared = await prepareAudioForStt(bytes, input.mimetype);
  const r = await transcribeRaw(apiKey, prepared, model);
  return {
    text: r.text,
    model,
    latency_ms: r.latency_ms,
    input_mimetype: r.audio.mimetype,
    input_ext: r.audio.ext,
    transcoded: r.audio.transcoded,
  };
}
