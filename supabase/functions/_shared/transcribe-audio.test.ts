// Integration test: envia um arquivo OGG/Opus (formato WhatsApp PTT — mono
// 16 kHz Opus) para o endpoint real do ElevenLabs Scribe e valida que a
// resposta traz os campos `text` (string) e `words` (array).
//
// Requer a variável de ambiente ELEVENLABS_API_KEY. Se não estiver definida,
// o teste é ignorado (não falha) para permitir rodar a suíte sem credenciais.
//
// A chamada é idêntica ao curl da doc oficial:
//   POST https://api.elevenlabs.io/v1/speech-to-text
//   Content-Type: multipart/form-data
//   -F file=@whatsapp-ptt.ogg
//   -F model_id=scribe_v2

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const FIXTURE_PATH = new URL("./__fixtures__/whatsapp-ptt.ogg", import.meta.url);
const API_URL = "https://api.elevenlabs.io/v1/speech-to-text";

Deno.test({
  name: "ElevenLabs /v1/speech-to-text aceita OGG/Opus do WhatsApp e retorna text + words",
  ignore: !Deno.env.get("ELEVENLABS_API_KEY"),
  async fn() {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY")!;

    // Carrega o fixture OGG/Opus (mono 16 kHz — mesmo container do PTT do WhatsApp).
    const audio = await Deno.readFile(FIXTURE_PATH);
    assert(audio.byteLength > 512, "fixture OGG/Opus vazio ou corrompido");
    // Sanity check do header OGG.
    const header = new TextDecoder().decode(audio.slice(0, 4));
    assertEquals(header, "OggS", "fixture não é um arquivo OGG válido");

    const blob = new Blob([audio], { type: "audio/ogg" });
    const form = new FormData();
    form.append("file", blob, "whatsapp-ptt.ogg");
    form.append("model_id", "scribe_v2");

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs STT falhou [${res.status}]: ${body.slice(0, 2000)}`);
    }

    const json = await res.json();

    assertEquals(
      typeof json.text,
      "string",
      `resposta sem campo text string. payload=${JSON.stringify(json).slice(0, 400)}`,
    );
    assert(
      Array.isArray(json.words),
      `resposta sem campo words array. payload=${JSON.stringify(json).slice(0, 400)}`,
    );

    // Se houver palavras (áudio com fala inteligível), cada uma deve ter os
    // campos documentados: start, end, text.
    for (const w of json.words) {
      assertEquals(typeof w.text, "string");
      assertEquals(typeof w.start, "number");
      assertEquals(typeof w.end, "number");
    }
  },
});
