# Corrigir transcrição de áudio do WhatsApp

## Diagnóstico

As duas mensagens de áudio do Mario foram transcritas com conteúdo totalmente inventado:

- Áudio 1 (6s, `A56A4D...ogg`) → "No entanto, a compreensão desses mecanismos... funções cerebrais e novas terapias para doenças neurológicas."
- Áudio 2 (8s, `A5A362...ogg`) → "Compreendo que a gente queira ter um plano, mas no momento não temos as informações necessárias..."

Ambas com `transcript_model: google/gemini-2.5-flash`. Este é o comportamento clássico de alucinação do Gemini quando recebe áudio curto em OGG/Opus via `input_audio` — ele completa com texto plausível em PT-BR em vez de transcrever. O modelo é multimodal, não é um STT dedicado, e não é adequado para essa tarefa.

O problema não é o pipeline (áudio chega ok, base64 tem tamanho compatível com a duração informada), é o **modelo escolhido**.

## Correção

Voltar a rota de OGG/Opus para o STT dedicado `openai/gpt-4o-transcribe`, mas com o áudio no formato correto. Duas alternativas — vou implementar a (A) que é mais simples e barata; se falhar em teste, aplico (B).

### (A) Rebranding do container: enviar OGG como `webm` para o gpt-4o-transcribe

Opus dentro de OGG e Opus dentro de WebM têm o mesmo codec. Vários projetos aproveitam isso enviando os bytes OGG com `filename=audio.webm` e `Content-Type: audio/webm` — o backend do modelo aceita porque só olha o codec Opus, que é suportado. Isso evita transcodificação.

Se o gateway/provider rejeitar (400 "corrupted/unsupported"), o código já registra `transcript_error` na mensagem, então mantemos a UX atual de "áudio não transcrito" e partimos para (B).

### (B) Fallback: transcodificar OGG/Opus → WAV PCM 16 kHz mono via WASM

Se (A) falhar em prova real, adicionar decodificação com um decoder Opus em WASM (por ex. `@evan/opus` ou `libopusjs`) dentro do edge function, remontar como WAV e enviar para `openai/gpt-4o-transcribe`. Custa +150 ms e ~200 KB de WASM, mas é 100% suportado.

## Escopo

Só mexer em **`supabase/functions/_shared/transcribe-audio.ts`**:

1. Remover a rota Gemini (`transcribeWithGemini`) — é ela que aluciná.
2. Em `transcribeAudio`, para OGG/Opus:
   - Chamar `transcribeWithOpenAI` passando o mesmo `base64`, mas com `mimetype = "audio/webm"` e extensão `webm` (estratégia A).
   - Manter o cabeçalho `filename` como `audio.webm` para bater com o Content-Type.
3. Demais formatos (WAV, MP3, M4A, WebM nativo, FLAC): sem mudança.
4. Manter a mensagem de erro clara em `transcript_error` quando o provider recusa.

Sem alterações em `hook7-webhook`, banco, UI ou fluxo de HITL.

## Validação

Após o deploy, pedir ao usuário para enviar um áudio novo pelo WhatsApp ao lead Mario. Esperado:

- `messages.metadata.hook7.audio.transcript_model = openai/gpt-4o-transcribe`
- `content` bate com o que foi falado (não texto inventado).
- Se o provider recusar o OGG-como-webm, vem `transcript_error` no metadata e a UI mostra `[áudio não transcrito]` — nesse caso, aplico o plano (B) na sequência.

## Fora de escopo

- Não vou tocar em `.lovable/plan.md`, hooks de UI, RLS, nem em outras rotas de mídia (imagem/documento).
- Sem instalação de WASM neste passo (só se (A) falhar).
