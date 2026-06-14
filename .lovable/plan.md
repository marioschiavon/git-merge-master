## Objetivo

Transformar o `sdr-agent` em um agente com estado real e loop completo de ferramentas — nunca confirmar antes de executar, nunca criar bookings duplicados, interpretar referências contextuais ("o segundo horário", "esse mesmo", "à tarde", "pode remarcar") e cobrir naturalmente perguntas de produto, consultas à base de conhecimento e criação de leads referral.

---

## Fase 1 — Idempotência

### 1.1 Dedup de webhooks inbound
- Adicionar colunas `provider` e `provider_message_id` em `public.messages`.
- Índice `UNIQUE (provider, provider_message_id) WHERE provider_message_id IS NOT NULL`.
- `inbound-webhook`, `zapi-webhook`, `twilio-whatsapp-webhook`, `inbound-email-webhook` extraem o ID nativo do canal e fazem insert com `ON CONFLICT DO NOTHING`. Se conflito → retorna 200 sem disparar agente.

### 1.2 Idempotência de ações de calendário
- Nova tabela `calendar_actions`:
  - `id`, `idempotency_key` (UNIQUE), `conversation_id`, `lead_id`, `action_type` (`book`/`reschedule`/`cancel`), `requested_start`, `status` (`pending`/`ok`/`failed`), `provider_booking_uid`, `request_payload` jsonb, `response_payload` jsonb, `created_at`, `updated_at`.
  - GRANTs + RLS por `company_id` via lead.
- `idempotency_key` = `sha256(conversation_id|action_type|requested_start|provider_booking_uid?)`.
- `calcom-booking-create/reschedule/cancel` recebem `idempotency_key`, inserem `calendar_actions` com status `pending` antes de chamar Cal.com, atualizam após resposta. Se chave já existir com status `ok`, retornam o resultado anterior sem nova chamada.

---

## Fase 2 — Loop nativo de ferramentas + histórico nativo

### 2.1 Histórico nativo
- Remover `buildHistoryAsUserMessage`.
- Montar `messages[]` com `role: user`/`assistant`/`tool` por turno. Para cada chamada de ferramenta de turnos anteriores, reproduzir o par (`assistant` com `tool_calls`, `tool` com `tool_call_id` + resultado) lendo de `sdr_agent_runs.steps`.
- Persistir em `sdr_agent_runs.steps`: `tool_call_id`, `name`, `arguments`, `result`, `latency_ms`.

### 2.2 Ferramentas de calendário viram tools reais ✅ (Fase 2B — implementada)
- `book_slot`, `reschedule_booking`, `cancel_booking` agora têm `execute` dentro do loop (`execBookingTool` em `sdr-agent/index.ts`):
  1. Modelo emite `tool_call` com `slot_start`.
  2. Backend roda guarda de confirmação (slot oferecido + confirmação explícita do lead na última inbound). Se falhar, retorna `{ ok:false, downgrade:'ask_confirmation', suggested_message }`.
  3. Reivindica `calendar_actions` com `idempotency_key` (Fase 1). Replay em caso de `existing`.
  4. Chama `calcom-confirm-booking` / `calcom-booking-reschedule` / `calcom-booking-cancel`.
  5. Retorna `tool` message com `{ ok, booking_uid, scheduled_at, message_suggestion }`.
  6. Modelo finaliza com `finalize({ decision:'send_message', message: message_suggestion })`.
- Removidas as branches `book_slot`/`reschedule_booking`/`cancel_booking` do live-mode do `sdr-agent` (não há mais ações pós-finalize de calendário).
- `finalize.decision` enum reduzido: removidos `book_slot`, `reschedule_booking`, `cancel_booking`.
- `execute-action` mantém os handlers `reschedule_booking`/`cancel_booking` por compatibilidade com `intent_action_rules` e outros disparos automáticos não-SDR.

### 2.3 Q&A, base de conhecimento e referral no mesmo loop
- **`search_knowledge`** (já existe): mantém RAG via `match_knowledge_chunks` (pgvector). Schema `strict: true` com `{ query: string, top_k?: int }`. Entra em `allowed_actions` para intents `product_question`, `objection`, `pricing`, `how_it_works`. Após retorno, `finalize_allowed = true` (responder com base nos chunks).
- **`update_lead_facts`** (já existe): schema `strict: true`, `additionalProperties: false`, sempre permitida, não bloqueia `finalize`.
- **`create_referral_lead`**: promovida a tool de primeira classe. Args: `referrer_lead_id`, `name`, `contact { email?, phone?, linkedin? }`, `context`. Backend normaliza contato e usa `UNIQUE (company_id, normalized_contact)` para idempotência; se já existir, retorna o lead existente. Após sucesso, enfileira `referral-followup-cron`. Entra em `allowed_actions` quando intent = `provides_referral`.

---

## Fase 3 — Estado estruturado + máquina de estados ✅ (implementada)

Novo módulo `supabase/functions/_shared/state-machine.ts` exporta `computeState()` + `renderStateBlock()`. `sdr-agent` chama no início de cada execução, injeta o JSON no system prompt e passa `allowed_actions`/`finalize_allowed` para o modelo. O `finalize_retry` cego foi substituído por re-prompt guiado: se o estado exige uma tool específica (ex.: `book_slot`, `check_calendar`, `search_knowledge`), o re-prompt força essa tool via `tool_choice` em vez de sempre forçar `finalize`.

### Stages detectados
`awaiting_first_reply`, `qualification`, `product_qna`, `scheduling_request`, `scheduling_waiting_confirmation`, `scheduling_confirming_now`, `reschedule_request`, `cancel_request`, `booking_confirmed`, `referral_provided`, `closed_lost`, `general`.

### `allowed_actions` / `finalize_allowed` por estado
- `product_qna` → `[search_knowledge, list_knowledge, read_knowledge_item, check_calendar, update_lead_facts, finalize]`, `finalize_allowed=false` até `search_knowledge`.
- `scheduling_request` → `[check_calendar, ...]`, `finalize_allowed=false` até `check_calendar`.
- `scheduling_waiting_confirmation` → `[update_lead_facts, finalize]`, `finalize_allowed=true`.
- `scheduling_confirming_now` (lead apontou um slot oferecido) → `[book_slot, ...]`, `finalize_allowed=false` até `book_slot`.
- `reschedule_request` com slot escolhido → `[reschedule_booking, ...]`, `finalize_allowed=false`.
- `cancel_request` → `[cancel_booking, ...]`, `finalize_allowed=false`.
- `booking_confirmed`, `referral_provided`, `closed_lost`, `general` → `finalize_allowed=true`.

### Arquivos alterados
- criado `supabase/functions/_shared/state-machine.ts`
- editado `supabase/functions/sdr-agent/index.ts` (compute+render no início de cada run; re-prompt guiado em vez de `finalize_retry`)

---

## Fase 3 (original — referência) — Estado estruturado + máquina de estados

### 3.1 Bloco de estado no system prompt
A cada turno, injetar JSON estruturado calculado em código (não inferido pelo modelo):

```text
conversation_stage, current_intent, timezone,
offered_slots[], selected_slot, active_booking,
pending_action, last_tool_call, last_tool_result,
knowledge_hits[], pending_referrals[],
allowed_actions[], finalize_allowed, confirmation_status
```

### 3.2 `allowed_actions` por estado (exemplos)
- `product_question` sem agenda → `[search_knowledge, update_lead_facts, finalize]`, `finalize_allowed=true` após `search_knowledge`.
- `product_question` + pedido de horário → `[search_knowledge, check_calendar, offer_slots, finalize]`, `finalize_allowed=false` até `offer_slots` ou resposta de Q&A pura.
- `wants_to_schedule` sem booking → `[check_calendar, offer_slots]`, então após oferta → `[book_slot]` quando lead confirma.
- `has_active_booking` + pedido remarcação → `[reschedule_booking, cancel_booking]`, bloqueia `book_slot`.
- `provides_referral` → `[create_referral_lead, finalize]`.
- `finalize` só liberado quando `finalize_allowed=true` (após tool result `ok` ou fluxo puro de conversa).

### 3.3 Remover `finalize_retry` forçado
Se modelo responde em texto durante stage que exige tool, re-prompt com `tool_choice` específico para a tool requerida (não `finalize`).

---

## Fase 4 — Guards obrigatórios antes de booking

Helper `assertCanBook(args, state)` checa em ordem:
1. `active_booking` existe → bloqueia `book_slot`, força `reschedule_booking`.
2. `calendar_actions` com mesmo `idempotency_key` e status `ok` → retorna resultado anterior.
3. Slot pedido pertence a `slot_holds` ativo OU `offered_slots` recentes (tolerância TZ ±5min).
4. Reconfirmação via `calcom-slots` (`check_datetime`) antes do POST final.

Falha de qualquer guard → tool result `{ ok: false, error_code, hint }` para o modelo se recuperar.

---

## Fase 5 — Cal.com síncrono + webhook como reconciliação

- Confirmação ao prospect usa a resposta síncrona de `calcom-booking-create` (já no loop).
- `calcom-webhook` deixa de disparar nova mensagem ao lead; só localiza `calendar_actions` pelo `booking_uid` e reconcilia status + grava em `bookings`. Eventos órfãos (sem `calendar_actions`) viram criação direta em `bookings` com `source='webhook'`.

---

## Fase 6 — Documentação do gateway

Criar `supabase/functions/_shared/ai-gateway.md` documentando que o gateway preserva `tool_call_id`, ordem das mensagens, `tool_choice`, e o formato esperado de `role: tool`.

---

## Fase 7 — Logs por execução

Expandir `sdr_agent_runs.steps[]` com:
- `messages_sent` (truncado), `structured_state`, `allowed_actions`
- `raw_model_response`, `tool_call.{name,args,result,latency_ms}`
- `final_message`, `state_delta`, `idempotency_key`
- Nunca registrar segredos/tokens.

---

## Arquivos afetados

- `supabase/functions/sdr-agent/index.ts` — reescrita do loop, schemas `strict: true`, histórico nativo, máquina de estados, registro de steps
- `supabase/functions/_shared/` — novos módulos: `state-machine.ts`, `idempotency.ts`, `booking-guards.ts`, `history-builder.ts`, `tool-schemas.ts`, `ai-gateway.md`
- `supabase/functions/inbound-webhook|zapi-webhook|twilio-whatsapp-webhook|inbound-email-webhook` — extrair `provider_message_id` + dedup
- `supabase/functions/calcom-booking-create|reschedule|cancel/index.ts` — aceitar e persistir `idempotency_key`
- `supabase/functions/calcom-webhook/index.ts` — modo reconciliação
- `supabase/functions/execute-action/index.ts` — remover branches de calendário
- `supabase/functions/referral-followup-cron/index.ts` — consumir fila gerada por `create_referral_lead`
- Migrações: colunas em `messages`, tabela `calendar_actions`, índices únicos para referral

---

## Fora de escopo

- UI, cadências, enriquecimento, troca de provider LLM
- `gmail-*`, `pipedrive-*`, `zapi-*` além de `provider_message_id`
- Reescrita de `enrich-lead`, `analyze-lead-website`, chunking/embedding

---

## Validação

Testes Deno cobrindo:
- Fluxo `offer_slots` → `book_slot` ok síncrono.
- Webhook duplicado (mesmo `provider_message_id`) não dispara 2 agentes.
- 2 cliques duplicados de confirmação → 1 só `calendar_actions` + 1 booking.
- Referência contextual: "o segundo horário", "esse mesmo", "à tarde", "pode remarcar".
- Q&A puro: pergunta de produto → `search_knowledge` → `finalize` sem agenda.
- Q&A + agenda: "como funciona e quando podemos falar?" → `search_knowledge` + `check_calendar` + `offer_slots`.
- Referral: "indico meu colega João, joao@x.com" → `create_referral_lead` idempotente.
- Replay do caso Juliano: após "Pode sim 👍🏻" não há re-oferta; `book_slot` executa.
