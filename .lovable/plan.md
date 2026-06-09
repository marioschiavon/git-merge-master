# Suíte completa de Agendamento Cal.com

Cobre as 4 áreas: **agendar, remarcar, cancelar, no-show/pós-reunião** — com webhooks do Cal.com, suporte a múltiplos event-types e round-robin de team.

## 1. Schema (1 migração)

**Novos enums** adicionados em `action_type`:
- `fetch_existing_booking`, `reschedule_booking`, `cancel_booking`, `ask_cancel_reason`, `offer_reschedule_instead`, `send_booking_confirmation`, `offer_event_types`, `collect_booking_info`, `detect_timezone`, `send_meeting_recap`, `request_feedback`, `mark_meeting_attended`

**Novos sub_intents** (texto livre já suportado, mas seedados):
- `reschedule_request`, `cancel_request`, `no_show_response`, `timezone_question`, `event_type_question`

**Nova tabela `bookings`** (espelho local do Cal.com):
- `id, company_id, lead_id, conversation_id`
- `calcom_booking_uid` (unique), `calcom_event_type_id`, `calcom_reschedule_uid`
- `status` enum: `pending|confirmed|rescheduled|cancelled|no_show|completed`
- `scheduled_at, duration_minutes, timezone`
- `meeting_url, location, attendees jsonb`
- `cancel_reason, reschedule_reason`
- `owner_user_id` (SDR/AE atribuído — round-robin)
- `previous_booking_id` (encadeia remarcações)

**Nova tabela `calcom_event_types`** (cache):
- `company_id, calcom_id, slug, title, length_minutes, description, active, default_for_intent`

**Nova tabela `calcom_webhook_log`**:
- `id, company_id, event_type, payload jsonb, processed_at, error`

Todas com GRANT + RLS por `company_id`.

## 2. Edge functions novas

| Função | Responsabilidade |
|---|---|
| `calcom-event-types` | Sincroniza event-types da conta Cal.com → `calcom_event_types` (rodar on-demand + cron diário) |
| `calcom-booking-create` | `POST /bookings` com nome/email/horário/event_type; grava em `bookings`; ativa `slot_hold` |
| `calcom-booking-reschedule` | `POST /bookings/{uid}/reschedule`; cria novo registro encadeado |
| `calcom-booking-cancel` | `DELETE /bookings/{uid}` com motivo; atualiza status |
| `calcom-booking-fetch` | `GET /bookings/{uid}` ou busca por email do lead |
| `calcom-webhook` | Recebe webhooks (`BOOKING_CREATED/RESCHEDULED/CANCELLED/NO_SHOW/MEETING_ENDED`), grava em `bookings` + dispara ações no pipeline |

`calcom-confirm-booking` existente vira wrapper de `calcom-booking-create` (compat).

## 3. Pipeline de intents — extensões

**`classify-intent`** ganha detecção de sub_intent específica para scheduling:
- prompt atualizado para distinguir `reschedule_request` vs `cancel_request` vs `new_booking` vs `no_show_response`
- extrai entidades: `target_date`, `target_time`, `cancel_reason`, `timezone`

**`route-intent` shared** ganha regras default:
- intent `meeting_request` + sub `reschedule_request` → `fetch_existing_booking` → `suggest_meeting_times` → aguarda
- intent `objection` + sub `cancel_request` → `ask_cancel_reason` → `offer_reschedule_instead` antes de `cancel_booking`
- intent `no_show` → `recover_no_show` (mensagem) + `suggest_meeting_times`

**`execute-action`** implementa os 12 novos handlers chamando as edge functions acima e gravando em `lead_activities`.

## 4. Webhook receiver do Cal.com

`calcom-webhook` (público, `verify_jwt=false`) valida assinatura HMAC com secret `CALCOM_WEBHOOK_SECRET` (vou pedir após aprovação).

Fluxo:
1. Valida assinatura
2. Identifica `lead_id` por email/booking_uid
3. Grava em `calcom_webhook_log` + atualiza `bookings`
4. Enfileira ações no `lead_action_queue`:
   - `BOOKING_CREATED` → `send_booking_confirmation` + `update_lead_score(+30)`
   - `BOOKING_RESCHEDULED` → mensagem de confirmação do novo horário
   - `BOOKING_CANCELLED` → reabrir cadência ou `disqualify_lead` (regra configurável)
   - `BOOKING_NO_SHOW_UPDATED` → `recover_no_show` (envia em 1h)
   - `MEETING_ENDED` → `send_meeting_recap` + `request_feedback` (24h depois)

## 5. Round-robin / multi-event-type

- `companies` ganha `calcom_team_id` (nullable) e `calcom_round_robin_enabled bool`
- Ao criar booking, se `round_robin_enabled`, usa endpoint de team do Cal.com (`/teams/{id}/event-types/{id}/bookings`)
- `offer_event_types` lista event-types ativos via `calcom_event_types` quando o lead pergunta "demo ou discovery?"

## 6. UI

**Nova página `/settings/calcom`**:
- Status da conexão (API key, event-types sincronizados)
- Lista de event-types com toggle ativo + dropdown "intent default"
- Toggle round-robin + campo team_id
- Campo webhook secret + URL para colar no painel Cal.com
- Histórico de webhooks recebidos (últimos 50)

**Página `/bookings`** nova:
- Lista de bookings (filtro por status, lead, owner)
- Ação inline: remarcar / cancelar / ver no Cal.com
- Timeline de remarcações encadeadas

**Lead detail** ganha aba "Agendamentos" mostrando bookings + ações rápidas (remarcar/cancelar manual).

## 7. Pedido de secrets (após aprovação)

- `CALCOM_WEBHOOK_SECRET` — para validar webhooks (você gera no painel Cal.com)

`CALCOM_API_KEY` e `CALCOM_EVENT_TYPE_ID` já existem.

## 8. Ordem de implementação

1. Migração (schema + enums + tabelas)
2. `calcom-event-types` + sync inicial
3. `calcom-booking-create/reschedule/cancel/fetch` + testes
4. `calcom-webhook` + secret + log
5. `execute-action` handlers novos
6. `classify-intent` prompt atualizado + seed de rules
7. UI `/settings/calcom` + `/bookings` + aba no lead
8. Cron diário para sincronizar event-types

## Riscos

- Webhook do Cal.com precisa ser configurado manualmente por você (te passo a URL)
- Round-robin só funciona em conta Cal.com Team (plano pago) — vou marcar como opcional
- `MEETING_ENDED` webhook depende de integração de vídeo no Cal.com (Zoom/Meet/Daily)
- Custo: ~zero, só API calls do Cal.com (sem limite no plano pago)

Confirme para eu implementar tudo de uma vez, ou diga se quer dividir em fases.
