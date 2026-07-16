
## Objetivo

Fazer o ElevenLabs Scribe aceitar o áudio nativo `.ogg` do WhatsApp. Sem fallback pro Gemini. Endpoint e formato ficam exatamente como na doc:

```
POST https://api.elevenlabs.io/v1/speech-to-text
Content-Type: multipart/form-data
-F file=@audio.ogg
-F model_id=scribe_v2
```

## Causas prováveis do `invalid_audio`

1. **`language_code: "por"`** no FormData — o Scribe usa ISO-639-1 (`pt`), não ISO-639-3 (`por`). Passar um code que ele não reconhece pode disparar o erro genérico de validação. A doc do curl (a que você mostrou) não envia `language_code` — o Scribe autodetecta.
2. **`convertToMp4: true`** como 1ª tentativa no `hook7-media.ts` — para áudio, o Evolution pode devolver um contêiner reencapsulado (com header ainda parecendo OGG pelo sniff, mas payload inconsistente). Baixar o arquivo original preserva o OGG/Opus como o WhatsApp gera.

## Mudanças

### `supabase/functions/_shared/transcribe-audio.ts`

- Remover do FormData: `language_code`, `tag_audio_events`, `diarize`. Enviar só `file` e `model_id`, igual ao curl da doc.
- Manter `whatsapp-audio.ogg` como filename (formato nativo aceito).
- Remover todo o caminho de fallback:
  - Apagar `transcribeWithGemini`, `GATEWAY_URL`, `FALLBACK_MODEL`, o campo `model?` em `TranscribeInput`, e o `catch` que caía no Gemini.
  - `transcribeAudio` fica: valida entrada → chama ElevenLabs → propaga qualquer erro (incluindo `ElevenLabsNotConfiguredError`).
- Aumentar o trecho do corpo de erro logado de 400 para 2000 chars, para o próximo caso mostrar o motivo real do ElevenLabs no log.

### `supabase/functions/_shared/hook7-media.ts`

Reordenar as tentativas de download para pedir o áudio original primeiro:

1. `getBase64FromMediaMessage` com `convertToMp4: false`.
2. `getBase64FromMediaMessage` sem o campo `convertToMp4` (default do Evolution).
3. `message/getBase64` (fallback antigo).
4. `media/download` (fallback antigo).
5. URL direta (último recurso; geralmente falha por criptografia do WhatsApp).

Sem outras alterações — o sniff pelo header continua determinando o mimetype real.

### Sem mudanças na UI / master

`platform-settings-status`, `elevenlabs-master-set`, `elevenlabs-master-test` e a página do Master ficam iguais.

## Verificação

- Enviar um novo áudio do WhatsApp para uma instância Hook7 e conferir no log do `hook7-webhook`:
  - Sucesso: linha com `text` transcrito e `latency_ms` do Scribe.
  - Se ainda falhar: o log agora traz o corpo completo do erro do ElevenLabs (não mais truncado em 400 chars). Usamos essa mensagem para o próximo ajuste — sem chutar, sem fallback silencioso.
