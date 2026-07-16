## Diagnóstico

Logs do `hook7-webhook` mostram `BootFailure` contínuo:

```
worker boot error: The requested module 'npm:opus-decoder@0.7.11'
does not provide an export named 'OggOpusDecoder'
  at .../_shared/transcribe-audio.ts:6:10
```

`transcribe-audio.ts` é importado pelo `hook7-webhook/index.ts`, então a função **inteira não sobe**. Todo evento do Hook7 — Message de áudio **e de texto** — cai numa função morta e nada é gravado em `messages`. Por isso nem texto está aparecendo na conversa.

Causa raiz: `OggOpusDecoder` não é exportado por `npm:opus-decoder` (esse pacote só exporta `OpusDecoder`, para frames Opus crus). O decoder que entende contêiner OGG (formato do WhatsApp) está em **`npm:ogg-opus-decoder`**.

## Correção

Único arquivo: `supabase/functions/_shared/transcribe-audio.ts`, linha 7.

- de: `import { OggOpusDecoder } from "npm:opus-decoder@0.7.11";`
- para: `import { OggOpusDecoder } from "npm:ogg-opus-decoder@0.1.16";`

Comentário do topo atualizado para refletir o pacote correto. Resto do arquivo intacto (`decodeOggOpusToWav`, `transcribeAudio`, roteamento por mimetype, envio WAV → `openai/gpt-4o-transcribe`, tratamento de 429/402).

Nenhuma mudança em `hook7-webhook`, UI, DB, RLS, storage ou HITL.

## Validação

1. Logs do `hook7-webhook` param de exibir `BootFailure` e voltam a mostrar `booted (time: …ms)`.
2. Mario envia **mensagem de texto** → aparece imediatamente na conversa (confirma que a função voltou a subir).
3. Mario envia **áudio novo** → grava em `messages`:
   - `content` = transcrição fiel ao áudio.
   - `metadata.hook7.audio.transcript_model = "openai/gpt-4o-transcribe"`.
   - Áudio salvo em `whatsapp-audio` (best-effort).
4. Pipeline IA (`inbound-webhook`) dispara normalmente para inbound.

Se ainda houver problema após o boot voltar, o erro real aparece em `metadata.hook7.audio.transcript_error` (ex.: 402 créditos, 429 rate limit) — sem mais falha silenciosa.

## Fora de escopo

Troca de modelo STT, mudanças em UI/storage/player/HITL, outras funções.
