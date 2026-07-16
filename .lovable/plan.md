# Fallback B: transcodificar OGG/Opus → WAV na edge

## Diagnóstico atualizado

O plano A (renomear OGG como `.webm` e enviar ao `openai/gpt-4o-transcribe`) foi rejeitado pelo provider — as duas novas mensagens de áudio caíram como `[áudio não transcrito]`. Precisamos entregar bytes que o modelo aceite de fato, ou seja, decodificar Opus para PCM e montar um WAV.

## Correção

Adicionar decodificação Opus 100% em WASM/JS dentro do edge function e enviar WAV 16 kHz mono ao `openai/gpt-4o-transcribe`.

### Alterações

1. **`supabase/functions/_shared/transcribe-audio.ts`**
   - Importar `npm:opus-decoder@^0.7` (biblioteca pura WASM, funciona em Deno edge, decodifica OGG/Opus completo).
   - Nova função `decodeOggOpusToWav(bytes)`:
     - Instancia `OggOpusDecoderWebWorker` ou `OggOpusDecoder` (sem worker, mais simples em Deno).
     - `await decoder.ready` → `decoder.decodeFile(bytes)` → `{channelData, sampleRate}`.
     - Downmix estéreo para mono (média dos canais).
     - Escrever cabeçalho RIFF/WAV PCM 16-bit little-endian + samples convertidos de Float32 para Int16.
     - Retornar `Uint8Array` com WAV completo.
   - Em `transcribeAudio`, para OGG/Opus:
     - Chamar `decodeOggOpusToWav`.
     - Enviar como `audio/wav` com filename `audio.wav` ao `openai/gpt-4o-transcribe`.
     - Se a decodificação falhar (ex: bytes corrompidos), lançar erro claro que vai para `transcript_error` no metadata da mensagem.
   - Demais formatos: sem mudança.

2. **Sem outras mudanças** — `hook7-webhook`, UI, banco, RLS, HITL não mudam. A mensagem já mostra `[áudio não transcrito]` como fallback quando `transcript_error` existe, o que só acontecerá se o áudio realmente estiver corrompido.

## Por que `opus-decoder` funciona em Deno edge

- Pacote `npm:opus-decoder` (autor: eshaz) é 100% WASM, sem dependências nativas.
- Suporta o container OGG completo (é o que o WhatsApp envia — OGG/Opus PTT).
- Deno edge suporta `npm:` specifiers e WebAssembly instanciação; não precisa de Node APIs.
- Peso do WASM: ~200 KB, cold start +80–150 ms — aceitável para uma edge chamada só quando chega áudio.

## Validação

Após deploy, enviar novo áudio ao Mario pelo WhatsApp. Esperado:

- `messages.metadata.hook7.audio.transcript_model = openai/gpt-4o-transcribe`
- `content` bate com o que foi falado (não mais alucinação nem "[áudio não transcrito]").
- Latência total sobe uns 100–300 ms (decodificação local) — aceitável.

Se, mesmo com WAV real, o STT falhar, o erro do provider entrará em `transcript_error` para diagnóstico.

## Fora de escopo

- Não vou tocar em outras rotas de mídia (imagem/documento), em UI, ou no formato de armazenamento no bucket.
- Não vou mudar o modelo padrão de STT — continua `openai/gpt-4o-transcribe`.
