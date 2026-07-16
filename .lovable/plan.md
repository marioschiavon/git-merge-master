## O que está acontecendo

- O fluxo atual está tentando mandar o áudio do WhatsApp para `/audio/transcriptions` com `openai/gpt-4o-transcribe`.
- O último log real do AI Gateway confirma o problema: `log_id 019f6cdb-4f6a-7e09-9e3c-86dd1b55c3fb`, `2026-07-16T21:35:40Z`, arquivo `audio.ogg`, `audio/ogg`, `12714 bytes`, erro upstream `400`: `Audio file might be corrupted or unsupported`.
- Ou seja: o app até está chamando STT, mas o provedor está rejeitando o OGG/Opus vindo do WhatsApp/Hook7. Ficar convertendo/remendando isso nos colocou em círculo.

## Plano de correção limpa

1. **Dar `/clear` no fluxo atual de transcrição**
   - Remover a tentativa de converter OGG/Opus para WAV dentro da edge function.
   - Parar de usar `/v1/audio/transcriptions` para áudio do WhatsApp.
   - Manter o upload do áudio original no storage para auditoria/debug.

2. **Trocar para Gemini multimodal via Lovable AI**
   - Criar um helper de transcrição que chama `chat/completions` com `google/gemini-2.5-flash` ou equivalente multimodal suportado.
   - Enviar o áudio como conteúdo multimodal base64 com o MIME real (`audio/ogg`, `audio/mp4`, `audio/webm`, etc.).
   - Prompt simples: transcrever fielmente o áudio e retornar somente o texto.

3. **Separar texto de áudio para não travar conversa**
   - Mensagens de texto não passam por nenhum código de transcrição.
   - Se a mensagem tem texto, grava e encaminha para o pipeline normalmente.
   - Se a mensagem tem áudio, baixa mídia, tenta Gemini, grava a transcrição ou `[áudio não transcrito]` com erro detalhado.

4. **Melhorar fallback sem esconder erro**
   - Se Gemini também rejeitar o arquivo, salvar no metadata: modelo, MIME, tamanho, erro do gateway e path do áudio.
   - Não bloquear a conversa inteira por falha de áudio.
   - Não disparar IA SDR para áudio sem transcrição, para evitar resposta errada.

5. **Validar com evidência real**
   - Depois da implementação, testar uma chamada real do helper com um áudio armazenado/recebido.
   - Conferir logs do `hook7-webhook` e AI Gateway.
   - Confirmar que mensagens de texto continuam entrando e que novos áudios passam pelo modelo Gemini, não mais pelo endpoint antigo de STT.

## Detalhes técnicos

- Arquivos principais:
  - `supabase/functions/_shared/transcribe-audio.ts`
  - `supabase/functions/hook7-webhook/index.ts`
  - possivelmente `supabase/functions/_shared/ai-gateway.ts` se precisar aceitar conteúdo multimodal com arrays.
- O endpoint antigo `audio_transcriptions` só ficará fora do caminho do WhatsApp.
- Não vou mexer em cadência, leads, regras de SDR ou UI — apenas fluxo de áudio/texto do webhook.