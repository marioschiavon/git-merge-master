## Objetivo
Validar as 7 fases do refactoring do `sdr-agent` (idempotência, loop nativo de tools, máquina de estados, guards, reconciliação síncrona, documentação gateway, logs por execução).

## Resumo do estado atual
- **1 lead ativo** (Juliano) com conversa real de 139 mensagens, 25 bookings históricos.
- **sdr-agent está operacional**: últimas execuções hoje (12:44, 12:46) mostram `book_slot` → guard de confirmação → `finalize` com mensagem sugerida funcionando corretamente.
- **Nenhum teste Deno existe** para as novas funções compartilhadas (`state-machine.ts`, `booking-guards.ts`, `idempotency.ts`, `history-builder.ts`).
- **calendar_actions está vazia** — nenhuma ação de calendário foi registrada ainda com o novo fluxo.

---

## Estratégia 1 — Testes de Unidade (Deno `_test.ts`)

### 1.1 `supabase/functions/_shared/booking-guards_test.ts`
Testar `assertCanBook` com dados mockados (sem banco):
- **Guard 1**: `book_slot` bloqueado quando há booking ativo → força `reschedule_booking`.
- **Guard 1**: `cancel_booking`/`reschedule_booking` bloqueados quando não há booking ativo.
- **Guard 3**: slot_start não corresponde a nenhuma oferta (±5min) → `slot_not_offered`.
- **Guard 3**: slot corresponde mas sem confirmação explícita → `no_confirmation` + `suggested_message`.
- **Guard 3**: confirmação implícita via referência contextual ("o segundo", "sexta às 15h") → `ok`.
- **Guard 4**: hold expirado → simular refresh via mock de `calcom-slots`.
- **Guard 4**: slot não disponível no refresh → `slot_unavailable` + reoffer.

### 1.2 `supabase/functions/_shared/state-machine_test.ts`
Testar `computeState` com diferentes intents:
- `wants_to_schedule` → stage `scheduling_request`, `finalize_allowed=false`, `allowed_actions` inclui `check_calendar`.
- `product_question` → stage `product_qna`, `finalize_allowed=false` até `search_knowledge`.
- Lead confirma slot oferecido → stage `scheduling_confirming_now`, `allowed_actions` inclui `book_slot`.
- `reschedule_request` com booking ativo → stage `reschedule_request`, `finalize_allowed=false`.
- `cancel_request` → stage `cancel_request`, `finalize_allowed=false`.
- `provides_referral` → stage `referral_provided`, `finalize_allowed=true`.
- Nenhuma inbound → `awaiting_first_reply`.

### 1.3 `supabase/functions/_shared/idempotency_test.ts`
- `buildIdempotencyKey`: mesmas entradas → mesmo hash SHA-256.
- `claimCalendarAction`: simular inserção, leitura existente, race condition.
- `insertInboundMessageDedup`: provider_message_id duplicado → `inserted=false`.

### 1.4 `supabase/functions/_shared/history-builder_test.ts`
- `buildNativeHistory`: inbound → `role:user`, outbound → `role:assistant`, system events → `role:system`.
- Mensagens vazias são descartadas.
- Timestamp BRT é prefixado no conteúdo.

---

## Estratégia 2 — Testes de Integração (Deno + Supabase Edge Functions)

### 2.1 `supabase/functions/sdr-agent/index_test.ts`
Testar a função como um todo via `Deno.serve` local ou mock de fetch:
- **Shadow mode**: `{ lead_id, mode: "shadow" }` → retorna `decision` sem enqueue/envio.
- **Q&A puro**: simular lead perguntando sobre produto → `search_knowledge` → `finalize` sem agenda.
- **Agendamento completo**: simular lead pedindo horário → `check_calendar` → `offer_slots` → confirmação → `book_slot` → confirmação de booking.
- **Confirmação insuficiente**: simular "Sexta" sem slot específico → `book_slot` retorna downgrade → `finalize` com pedido de confirmação.
- **Reschedule**: simular lead com booking ativo pedindo remarcação → `reschedule_booking`.

### 2.2 `supabase/functions/calcom-webhook/index_test.ts`
- **BOOKING_CREATED órfão** (sem calendar_actions): cria booking com `source='webhook'`, enfileira confirmação.
- **BOOKING_CREATED com calendar_actions**: apenas reconcilia, não envia mensagem ao lead.
- **BOOKING_CANCELLED pelo lead**: enfileira ação de follow-up.
- **BOOKING_CANCELLED pelo organizer**: não enfileira ação.
- **MEETING_ENDED**: enfileira `send_meeting_recap`, `request_feedback`.
- **Signature inválida**: retorna 401.

---

## Estratégia 3 — Testes End-to-End via API (curl_edge_functions)

### 3.1 Teste com lead real (Juliano) em shadow mode
```
POST /sdr-agent
{ "lead_id": "61a9b13e-93d9-404e-9ad9-a7a91b1c5bac", "mode": "shadow", "trigger": "manual" }
```
Verificar:
- `steps[]` contém `structured_state`, `allowed_actions`, `model_response`.
- `finalize_allowed` é `false` em stages que exigem tool.
- Nenhuma mensagem é enviada realmente.

### 3.2 Teste de dedup de webhook inbound
```
POST /inbound-webhook (ou zapi-webhook/twilio-whatsapp-webhook)
```
Enviar mesmo `provider_message_id` 2x → segunda deve ser ignorada (200 sem disparar agente).

### 3.3 Teste de calcom-webhook com payload real
Usar payload de um dos bookings existentes (ex: `ranM5UgTVZKY84GYEXtsqp`) e verificar:
- `bookings.source` preenchido corretamente.
- `calendar_actions.reconciled_at` atualizado (se houver ação originada).

---

## Estratégia 4 — Testes de Regressão Manual (UI + Preview)

### 4.1 Pipeline de conversa no preview
- Acessar `/conversations` no preview.
- Verificar que as mensagens do Juliano continuam renderizando corretamente.
- Verificar que o botão "Simular resposta do agente" funciona.

### 4.2 Logs de execução
- Verificar que `sdr_agent_runs.steps` contém os novos campos da Fase 7 (`turn_context`, `model_response`, `tool_call`, etc.).
- Confirmar que não há vazamento de tokens/secrets nos logs.

---

## Ordem de execução recomendada

```
1. Testes de unidade (Deno) — rápidos, não precisam de deploy
2. Deploy das funções atualizadas
3. Teste E2E shadow mode com lead real
4. Teste de dedup via webhook
5. Teste de calcom-webhook com payload simulado
6. Validação visual no preview
```

## Notas
- Para testes de unidade que precisam de Supabase (idempotency), usar `supabase--test_edge_functions` que roda com `--allow-net` e `--allow-env`.
- O lead Juliano tem dados reais suficientes para testes shadow mode significativos.
- Todos os bookings atuais estão `cancelled`/`rescheduled`, então testar `book_slot` com ele deve passar pelo Guard 1 (sem conflito de booking ativo).