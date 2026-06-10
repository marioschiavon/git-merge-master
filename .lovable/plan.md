# Substituir Twilio por Z-API (WhatsApp)

Trocar o provider de WhatsApp em todo o sistema mantendo a mesma interface (envio/recebimento por empresa, multi-tenant via `integrations`). Z-API usa autenticação por instância (`instanceId` + `token` + `Client-Token` de segurança da conta).

## 1. Helper compartilhado novo

Criar `supabase/functions/_shared/zapi-whatsapp.ts` substituindo `twilio-whatsapp.ts`:

- `ZApiConfig { instance_id, token, client_token, whatsapp_number? }`
- `getZApiConfig(supabase, companyId)` — lê `integrations` onde `provider='zapi_whatsapp'` e `status='active'`.
- `sendWhatsAppViaZApi(cfg, toPhone, body)` — `POST https://api.z-api.io/instances/{instance_id}/token/{token}/send-text` com header `Client-Token: {client_token}` e body `{ phone, message }`. Telefone Z-API = E.164 sem `+` (ex.: `5511999999999`).
- `verifyZApiCredentials(cfg)` — `GET .../status` para validar.
- Retornos no mesmo formato `{ ok, sid?, status?, error? }` para minimizar mudanças nos chamadores (sid = `messageId` da Z-API).

Não vamos remover `_shared/twilio-whatsapp.ts` imediatamente — deixar marcado como deprecated e remover depois que tudo estiver migrado e validado.

## 2. Edge functions a atualizar

Substituir imports `getTwilioConfig`/`sendWhatsAppViaTwilio` → `getZApiConfig`/`sendWhatsAppViaZApi` em:

- `supabase/functions/cadence-executor/index.ts` (2 pontos: first message + step normal)
- `supabase/functions/slot-expiry-followup/index.ts`
- `supabase/functions/inbound-webhook/index.ts` (3 pontos: referral outreach, reply automática, qualquer outro fallback de WhatsApp)
- `supabase/functions/send-outbound-message/index.ts` (envio manual do SDR)

Renomear chaves no `metadata.delivery_*`: `twilio_sid` → `zapi_message_id`, `twilio_status` → `zapi_status`, `twilio_error` → `zapi_error`. Mensagens de log/erro atualizadas para "Z-API".

## 3. Webhook de entrada

Criar `supabase/functions/zapi-webhook/index.ts` (registrar em `supabase/config.toml` com `verify_jwt = false`):

- Recebe JSON da Z-API (eventos `ReceivedCallback` para mensagens recebidas).
- Lê `phone` (remetente), `text.message`, `fromMe` (ignorar se `true`), `instanceId`.
- Localiza empresa pelo `instanceId` em `integrations.config.instance_id`.
- Localiza lead pelo telefone (mesma lógica do webhook Twilio atual, normalizando para `+E.164`).
- Cria/atualiza conversation, insere `messages` (direction=inbound, channel=whatsapp).
- Encaminha para `inbound-webhook` (`skip_insert: true`) para classificação de intenção / IA — fluxo idêntico ao Twilio atual.

`twilio-whatsapp-webhook` e `twilio-test-connection` permanecem por ora, mas não serão mais usadas e podem ser deletadas em fase 2.

Criar também `supabase/functions/zapi-test-connection/index.ts` que recebe `{ instance_id, token, client_token }` e chama `verifyZApiCredentials`.

## 4. Tela de Integrações (`src/pages/settings/Integrations.tsx`)

Substituir o `TwilioWhatsAppCard` por `ZApiWhatsAppCard`:

- Campos: **Instance ID**, **Instance Token**, **Client-Token (Security Token da conta Z-API)**, **Número WhatsApp conectado** (E.164).
- Salva em `integrations` com `provider='zapi_whatsapp'`, `config = { instance_id, token, client_token, whatsapp_number }`.
- Botão "Testar conexão" → invoca `zapi-test-connection`.
- Exibe a URL de webhook a ser colada no painel Z-API (Webhooks → "Ao receber"): `https://{project}.supabase.co/functions/v1/zapi-webhook`.
- Texto e link de ajuda apontando para `https://app.z-api.io/` em vez do console Twilio.

Remover toda menção a sandbox/Twilio na UI.

## 5. Dados existentes

Não há migration de schema necessária (campos `config jsonb` já comportam). Se já existir uma row em `integrations` com `provider='twilio_whatsapp'` da Revivere, ela fica inativa — o usuário cadastrará as credenciais Z-API e desativará a antiga manualmente pela UI (botão Desconectar já existente).

## 6. Secrets

Z-API é por-empresa (cada cliente tem sua instância), igual ao Twilio atual. Nada vai para `Deno.env` — tudo fica em `integrations.config`. **Nenhum secret novo precisa ser adicionado.**

## Fora de escopo

- Templates HSM / aprovação Meta (Z-API funciona com número conectado via QR Code, sem HSM).
- Mídia (áudio/imagem/documento) — manter só texto, como está hoje no Twilio.
- Remover arquivos `twilio-*` — fica para uma limpeza após validação em produção.
- Migrar histórico de mensagens (metadados antigos `twilio_sid` continuam armazenados, sem impacto).

## Detalhes técnicos da Z-API

- Endpoint envio texto: `POST https://api.z-api.io/instances/{instance}/token/{token}/send-text`
- Header obrigatório: `Client-Token: <Account Security Token>`
- Body: `{ "phone": "5511999999999", "message": "..." }`
- Resposta sucesso: `{ "zaapId": "...", "messageId": "..." }`
- Webhook de entrada: JSON com `type`, `phone`, `fromMe`, `text: { message }`, `instanceId`, `messageId`, `momment`.
- Status da instância: `GET .../status` → `{ connected: true, ... }`.
