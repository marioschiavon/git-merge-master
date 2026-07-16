# Integração ElevenLabs como chave master

Adicionar o ElevenLabs ao painel **Master → Integrações da Plataforma**, seguindo exatamente o mesmo padrão já usado pelo Resend (chave criptografada no banco, gerenciada pela UI), e trocar a transcrição de áudio do WhatsApp para usar a API `speech-to-text` do ElevenLabs em produção.

## Por que ElevenLabs para STT
O modelo `scribe_v2` do ElevenLabs aceita OGG/Opus (formato nativo do WhatsApp) sem precisar de transcode e tem qualidade superior em pt-BR em comparação ao fluxo multimodal atual via Gemini.

## O que muda

### 1. Banco (nova coluna master, criptografada)
Migration adicionando em `platform_settings`:
- `elevenlabs_api_key_encrypted text` — chave criptografada com a mesma passphrase (`PLATFORM_SECRETS_PASSPHRASE`) usada hoje pelo Resend.
- `elevenlabs_connected_at timestamptz`
- `elevenlabs_model text default 'scribe_v2'` (permite trocar para `scribe_v2_realtime` futuramente sem redeploy)

Nenhuma coluna existente é alterada. Sem mudança de RLS (a tabela `platform_settings` já é master-only).

### 2. Novas Edge Functions (espelhando o padrão do Resend)
- `elevenlabs-master-set` — recebe `{ api_key }`, criptografa e grava em `elevenlabs_api_key_encrypted`.
- `elevenlabs-master-test` — descriptografa e faz `GET https://api.elevenlabs.io/v1/user` para validar a chave, retornando `{ ok, subscription_tier, character_limit }`.
- `elevenlabs-master-clear` — zera a chave.

Todas exigem `is_master_admin(auth.uid())`, mesmo padrão dos endpoints `resend-master-*`.

### 3. `platform-settings-status` (edge function existente)
Estender o retorno atual com um bloco:
```
elevenlabs: {
  key_configured: boolean;
  connected_at: string | null;
  model: string;
}
```
Sem quebrar nenhum campo já retornado.

### 4. UI — `src/pages/master/PlatformSettings.tsx`
Novo card **"Áudio · ElevenLabs (master)"** posicionado abaixo do card do Resend, com:
- Badge de status (Configurado / Não configurado)
- Campo `password` para colar a chave (`sk_...`)
- Botões **Salvar**, **Testar** e **Limpar** (idênticos aos do Resend)
- Select do modelo: `scribe_v2` (padrão) / `scribe_v2_realtime`
- Texto explicativo: "Chave usada por todas as empresas para transcrever áudios recebidos no WhatsApp."

Nenhuma outra tela é afetada.

### 5. Trocar a transcrição em produção
Reescrever `supabase/functions/_shared/transcribe-audio.ts` para:
1. Ler a chave descriptografada de `platform_settings.elevenlabs_api_key_encrypted` (helper reutilizando o mesmo `decryptWithPassphrase` já usado pelo Resend).
2. Chamar `POST https://api.elevenlabs.io/v1/speech-to-text` com `multipart/form-data`:
   - `file` = blob OGG/Opus (a partir do base64 vindo do Hook7)
   - `model_id` = `scribe_v2`
   - `language_code` = `por`
   - `tag_audio_events` = `false`
   - `diarize` = `false`
3. Extrair `text` da resposta JSON.
4. **Fallback**: se a chave master não estiver configurada OU se o ElevenLabs retornar 5xx/timeout, cair no fluxo atual (Gemini multimodal via Lovable AI Gateway) para não parar recebimento de mensagens em produção. Logs distinguem qual foi usado.

A assinatura pública `transcribeAudio(input)` e o shape do `TranscribeResult` permanecem iguais — `hook7-webhook/index.ts` não precisa mudar.

## Segurança
- Chave nunca aparece no frontend depois de salva (só o status booleano).
- Descriptografia acontece só dentro das edge functions master e do `_shared/transcribe-audio.ts`.
- Nada de `VITE_ELEVENLABS_*`. A chave é master-only, exatamente como o Resend hoje.

## Fora do escopo
- TTS, música, SFX, ou agentes conversacionais do ElevenLabs — só STT.
- Realtime streaming (`scribe_v2_realtime`) — o schema já suporta trocar o modelo, mas o webhook Hook7 continua batch.
- Interface por empresa — a chave é única e master, como pedido.

## Diagrama do fluxo de transcrição

```text
Hook7 → hook7-webhook → _shared/transcribe-audio.ts
                              │
                              ├─ chave master ElevenLabs configurada? 
                              │      sim → POST /v1/speech-to-text (scribe_v2)
                              │      não → Gemini multimodal (Lovable AI Gateway)
                              │
                              └─ falha 5xx no ElevenLabs → fallback Gemini
```
