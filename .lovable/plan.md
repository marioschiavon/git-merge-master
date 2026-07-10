
# Cal.com multi-tenant por empresa

Hoje a integração usa 3 secrets globais (`CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_BOOKING_LINK`) e um webhook único. Todas as empresas escrevem na mesma conta Cal.com. O plano abaixo isola por empresa mantendo compatibilidade retro (secrets globais viram fallback opcional para o master).

## 1. Banco de dados

Adicionar colunas em `companies` (as 3 de team/event-type já existem):

- `calcom_api_key_encrypted bytea` — API key criptografada com pgp_sym (mesmo padrão do `hook7_instances.token_encrypted`).
- `calcom_booking_link text` — link público de agendamento.
- `calcom_webhook_secret text` — HMAC secret do webhook (por empresa, gerado no connect).
- `calcom_connected_at timestamptz`, `calcom_last_error text`.

Novo secret runtime: `CALCOM_KEY_PASSPHRASE` (gerado via `generate_secret`, 64 chars) para cifrar/decifrar. Duas funções SECURITY DEFINER análogas às do Hook7:
- `set_calcom_api_key(company_id uuid, api_key text, passphrase text)`
- `get_calcom_api_key(company_id uuid, passphrase text) returns text`

RLS: só company_admin da própria empresa pode chamar `set_`; `get_` só é chamada pelo backend com service_role + passphrase do env.

## 2. Helper por empresa (backend)

Refatorar `supabase/functions/_shared/calcom.ts`:

- Nova função `getCompanyCalcomCreds(supabase, companyId)` → `{ apiKey, eventTypeId, bookingLink, webhookSecret }` decriptando via `get_calcom_api_key`. Cache em memória por invocação.
- `calcomFetch`, `cancelCalcomBooking`, `cancelCalcomReservation`, `resolveEventTypeId`, `fetchEventTypeLengthMinutes` passam a receber `apiKey` como parâmetro (deixam de ler `Deno.env`).
- `resolveEventTypeId` prioriza `companies.calcom_default_event_type_id` antes de cair no primeiro event type retornado.

Novo helper `_shared/calcom-creds.ts` com `requireCompanyCalcom(supabase, companyId)` que lança erro amigável se a empresa não conectou.

## 3. Edge functions afetadas

Atualizar cada função para resolver `company_id` primeiro e chamar o helper:

- `calcom-slots`, `calcom-confirm-booking`, `calcom-booking-create`, `calcom-booking-cancel`, `calcom-booking-reschedule`, `calcom-booking-fetch`, `calcom-add-guests`, `calcom-event-types`
- `expire-slot-holds` e `slot-expiry-followup` — hoje leem `CALCOM_API_KEY` global; passar a agrupar holds por `company_id` e resolver a key de cada empresa
- `inbound-webhook`, `execute-action` — passar `companyId` para os helpers Cal.com
- `human-day-slots`, `human-book-slot`, `human-reschedule-booking`, `human-cancel-booking`, `human-offer-slots`, `human-active-booking` — puxar `company_id` da conversa
- `_shared/meeting-duration.ts` — receber `apiKey` do caller

## 4. Webhook multi-tenant

`calcom-webhook` hoje é uma URL única com um único HMAC secret. Nova estratégia:

- URL passa a incluir slug: `…/functions/v1/calcom-webhook/{company_slug}` (parseado do path).
- A função carrega `companies.calcom_webhook_secret` daquela empresa e valida o HMAC contra ela.
- Cai no comportamento antigo (secret global) se o path não tiver slug — mantém webhooks já cadastrados funcionando durante a migração.
- `calcom_webhook_log.company_id` já existe; passa a ser preenchido direto pelo path em vez de lookup por `booking_uid`.

## 5. Novas edge functions

- `calcom-connect` — recebe `{ api_key, booking_link }`, valida chamando `/v2/me`, chama `set_calcom_api_key`, sincroniza event types, gera `calcom_webhook_secret` (32 chars random), retorna URL do webhook + secret pro usuário colar no Cal.com.
- `calcom-disconnect` — limpa colunas na empresa e desativa `calcom_event_types`.
- `calcom-test-connection` — bate `/v2/me` com a chave em memória (sem persistir) pra validar antes de salvar.

## 6. UI

**`src/pages/settings/Integrations.tsx`** — trocar o `CalcomDialog` atual (que só explica variáveis globais) por um dialog real com:

- Campos: API Key (password), Booking link, e event type padrão (dropdown após validar).
- Botão "Testar conexão" → `calcom-test-connection`.
- Botão "Conectar" → `calcom-connect`. Ao sucesso mostra URL do webhook + secret gerado com botões copiar, e instruções para cadastrar no painel do Cal.com (eventos: BOOKING_CREATED, RESCHEDULED, CANCELLED, NO_SHOW_UPDATED, MEETING_ENDED).
- Status "Conectado / Desconectado / Erro" com `useIntegration('calcom')` (usar a mesma tabela `integrations` ou colunas na `companies`).

**`src/pages/settings/CalcomSettings.tsx`** — a URL do webhook exibida passa a incluir o slug da empresa; texto sobre `CALCOM_WEBHOOK_SECRET` global vira "secret desta empresa (regenerar)".

Novos hooks em `useCalcom.ts`: `useCalcomConnect`, `useCalcomDisconnect`, `useCalcomTestConnection`, `useCalcomWebhookInfo`.

## 7. Migração e retro-compat

- Se `companies.calcom_api_key_encrypted` estiver nulo, o helper cai no `Deno.env.get("CALCOM_API_KEY")` global (fase de transição — só a empresa "master" continua funcionando pelo env).
- Manual (`docs/manual/03e-calcom.md`) reescrito: cada empresa gera sua API key no Cal.com, cola em Integrações, copia a URL do webhook + secret e cadastra no Cal.com.
- Remover leitura dos secrets globais em uma segunda fase depois de todas as empresas migrarem.

## Detalhes técnicos

- **Criptografia**: `pgp_sym_encrypt/decrypt` na extensão `pgcrypto` já usada por hook7. Nova passphrase `CALCOM_KEY_PASSPHRASE` isolada da do Hook7.
- **Round-robin/team**: `calcom_team_id` e `calcom_round_robin_enabled` continuam por empresa (nada muda).
- **`expire-slot-holds`**: mudar para `SELECT ... FROM slot_holds` agrupado por `company_id`, resolver key de cada empresa em batch e cancelar reservations com a key correta.
- **Assinatura de webhook**: manter `x-cal-signature-256` HMAC-SHA256 do raw body com o secret da empresa resolvida via slug.
- **Slug**: usar `companies.slug` (já existe e é único).
