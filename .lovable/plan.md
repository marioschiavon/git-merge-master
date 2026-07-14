
## Objetivo

Hoje, no `hook7-webhook`, mensagens sem texto (áudio, imagem, etc.) são descartadas na linha:

```ts
if (!text) { console.log("...mídia? ignorada"); return "ignored"; }
```

Queremos que **áudio** (o caso mais comum de resposta do lead) seja:
1. Baixado do Hook7,
2. Transcrito para texto via Lovable AI (`openai/gpt-4o-transcribe`),
3. Salvo em `messages` como se fosse uma mensagem de texto normal,
4. Encaminhado ao `inbound-webhook` — que responde em **texto** (comportamento atual, sem mudança).

Outras mídias (imagem, vídeo, documento, sticker) continuam ignoradas nesta fase.

## Escopo desta fase

Somente WhatsApp via Hook7. Áudio → texto → resposta em texto. Sem TTS, sem responder em áudio.

## Mudanças

### 1. Novo helper `supabase/functions/_shared/hook7-media.ts`
- `extractAudioRef(data)` — lê `data.Message.audioMessage` (URL, mimetype, seconds, ptt, fileLength). Retorna `null` se não for áudio.
- `downloadHook7Media(instance, externalId, token)` — chama o endpoint do Hook7 que devolve o arquivo desencriptado em base64 (o Evolution-Go expõe algo como `POST /chat/getBase64FromMediaMessage/{instance}` com `{ message: { key: { id } } }`; endpoint exato a confirmar na implementação lendo a doc do Hook7 e testando com uma instância real). Retorna `{ base64, mimetype }`.

### 2. Novo helper `supabase/functions/_shared/transcribe-audio.ts`
- `transcribeAudio({ base64, mimetype }): Promise<{ text, model, latency_ms }>`
- Monta `FormData` com `file` (Blob a partir do base64, extensão derivada do mimetype: ogg/opus → `.ogg`, mp4/m4a → `.m4a`, mp3 → `.mp3`) e `model = openai/gpt-4o-transcribe`.
- `POST https://ai.gateway.lovable.dev/v1/audio/transcriptions` com `Authorization: Bearer ${LOVABLE_API_KEY}`.
- Trata 402/429 explicitamente (loga e devolve erro tipado); sem `stream` (modo buffered — é backend, não UI).
- Áudio WhatsApp é OGG/Opus, formato aceito pelo `gpt-4o-transcribe`; não precisa transcodar.

### 3. Ajuste em `supabase/functions/hook7-webhook/index.ts` (`handleMessage`)
Substituir o bloco atual "sem texto → ignored" por:

```
text ← conversation | extendedTextMessage.text
if (!text):
  audioRef ← extractAudioRef(data)
  if (audioRef):
    media ← downloadHook7Media(...)
    transcript ← transcribeAudio(media)
    text ← transcript.text        // vira o content da mensagem
    audioMeta ← { seconds, mimetype, ptt, transcript_model, transcript_latency_ms, storage_path? }
  else:
    log "mídia não-áudio ignorada" ; return "ignored"
```

Fluxo restante fica igual: dedup por `provider_message_id`, upsert de `conversation`, insert em `messages` (com `metadata.hook7.audio = audioMeta`), e forward para `inbound-webhook` com `content = text`.

Se `downloadHook7Media` ou `transcribeAudio` falhar:
- Insere a mensagem mesmo assim com `content = "[áudio não transcrito]"` e `metadata.hook7.audio.transcript_error = "..."`, mas **não** dispara `inbound-webhook` (evita a IA responder algo genérico a um áudio que não entendeu). Fica visível na Inbox humana para takeover manual.

### 4. (Opcional / recomendado) Storage do áudio para playback na UI
- Criar bucket privado `whatsapp-audio` (migration).
- Após download, subir o arquivo em `whatsapp-audio/{company_id}/{conversation_id}/{provider_message_id}.ogg` e guardar o path em `metadata.hook7.audio.storage_path`.
- Frontend (fase seguinte, fora deste plano) pode gerar signed URL e exibir player. Nesta fase apenas gravamos — sem mudar UI ainda.

Se preferir manter mínimo agora, pulamos o bucket e guardamos só a transcrição — a mensagem aparece como texto na Inbox. Confirme na aprovação (ver "Decisões abertas").

### 5. Bump de versão
`src/lib/version.ts` → `alpha 0.24`.

## Decisões em aberto (respondo pelo padrão se não houver preferência)

1. **Salvar o arquivo de áudio no Storage para playback futuro?**
   - Padrão sugerido: **sim**, cria bucket `whatsapp-audio`. Custo é baixo e evita retrabalho quando formos exibir o player.
2. **Comportamento em falha de transcrição:**
   - Padrão sugerido: gravar mensagem como `[áudio não transcrito]` **sem** disparar IA, deixando para a Inbox humana.

## Fora de escopo (fases futuras)

- Responder em áudio (TTS).
- Transcrever imagens/documentos (OCR/visão).
- Exibir player de áudio na UI (Conversations/Inbox).
- Áudio em outros canais (email, LinkedIn) — não se aplica.

## Detalhes técnicos

- Modelo STT: `openai/gpt-4o-transcribe` (default do knowledge de STT).
- Endpoint: `POST https://ai.gateway.lovable.dev/v1/audio/transcriptions`, `multipart/form-data`, `Authorization: Bearer LOVABLE_API_KEY` (server-side only).
- Mimetypes esperados do WhatsApp: `audio/ogg; codecs=opus` (mais comum) e `audio/mp4`. Ambos aceitos pelo modelo.
- Nome do part `file` deve ter extensão coerente com o mimetype — senão o modelo devolve 400 "corrupted/unsupported".
- Erros do gateway (402/429) já são tratados nas outras edge functions do projeto; seguir mesmo padrão de log.
- Idempotência: continua garantida pelo `provider_message_id` unique — se o Hook7 reenviar o mesmo áudio não retranscrevemos.
- Custo: cada transcrição consome créditos Lovable AI proporcional à duração; áudios de WhatsApp costumam ter < 60s.

## Ordem de implementação

1. Migration do bucket `whatsapp-audio` (se decisão 1 = sim).
2. `_shared/transcribe-audio.ts`.
3. `_shared/hook7-media.ts` (com teste manual contra 1 áudio real da instância conectada).
4. Ajuste em `hook7-webhook/index.ts`.
5. Bump `version.ts` → `alpha 0.24`.
6. Deploy e validação com um áudio de teste na Inbox.
