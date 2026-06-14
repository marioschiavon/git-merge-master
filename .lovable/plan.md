## Diagnóstico

Olhando o último run do lead (`526345a6...`, 14:36:23): o SDR não parou por bug de lógica — ele caiu em `decision=silence` **porque a tool `reschedule_booking` falhou 3 vezes seguidas** e o loop esgotou.

Sequência observada nos `steps`:
1. Pipeline determinístico funciona: intent=`confirm_slot` (conf=1.0), slot=`2026-06-22T20:00Z`, `forced_tool=reschedule_booking` sobre o booking ativo `b4ADMYcJmojrtEP57rSuR5` (18/06 17:45 BRT).
2. `reschedule_booking` → `FunctionsHttpError: Edge Function returned a non-2xx status code` (3x).
3. Modelo redige mensagem de fallback ("Tivemos uma instabilidade..."), mas como `finalize_allowed=false` e o pending action é `reschedule_then_confirm`, o loop nunca conseguiu emitir `finalize(send_message)` e terminou em **silêncio**.

Confirmação na infra:
- `calendar_actions` do lead: **6 linhas seguidas com `status=failed`** para o mesmo `booking_uid=b4ADMYcJmojrtEP57rSuR5`, todas com `error_message='FunctionsHttpError…'` — ou seja, a edge function `calcom-booking-reschedule` está retornando não-2xx, mas **o erro real do Cal.com não está sendo logado** (o `console.error` interno não aparece nos logs).
- Edge logs HTTP da reschedule: 9× `POST | 409` no último minuto. Ou é o Cal.com devolvendo 409 (conflito — slot já bookado / booking inválido), ou é o nosso próprio short-circuit `claim.kind === "pending"` devolvendo 409 e nunca chegando ao Cal.com.

**Sua hipótese está correta no espírito**: existe um booking antigo (`b4ADMYcJmojrtEP57rSuR5`, 18/06) e o reschedule contra ele está falhando em loop. Pode ser (a) o uid não existe mais no Cal.com, (b) o slot destino conflita com outra reunião na agenda, ou (c) o claim de idempotência está travando antes do Cal.com ser chamado. Hoje não dá pra distinguir porque a mensagem original do Cal.com é descartada.

## Plano

### 1. Tornar o erro do Cal.com visível (root cause)
`supabase/functions/calcom-booking-reschedule/index.ts`:
- Capturar o erro real do `calcomFetch` (já vem como `Cal.com /v2/.../reschedule 409: {body}`) e:
  - gravar em `calendar_actions.response_payload` o `{ status, body }` retornado pelo Cal.com;
  - retornar `jsonResponse({ error, calcom_status, calcom_body }, calcomStatus || 502)` para que o SDR veja o erro estruturado.
- Idem em `calcom-booking-create` e `calcom-booking-cancel` para padronizar.
- `calcomFetch` passa a anexar `err.status` e `err.body` na exceção para os callers não precisarem fazer regex no `message`.

### 2. Distinguir falha de idempotência vs falha do Cal.com
`calcom-booking-reschedule`:
- Quando `claim.kind === "pending"`, devolver `{ in_flight: true }` com status **425** (Too Early) em vez de 409, para não colidir com 409 do próprio Cal.com nos logs.
- Quando `claim.kind === "pending"` e o `updated_at` do claim > 60s, considerar órfão e re-clamar (status="pending" stale → reset para nova tentativa).

### 3. Sincronizar booking antes de reschedule
`calcom-booking-reschedule`, antes de chamar `/reschedule`:
- `GET /v2/bookings/{uid}` para validar o booking.
- Se 404 → marcar `bookings.status='cancelled'` localmente, devolver `{ error_code: "booking_not_found", suggested_message: "Vou criar um novo agendamento" }` para que o sdr-agent caia em `book_slot`.
- Se status no Cal.com já é `cancelled`/`rejected` → mesmo tratamento.

### 4. Tratamento estruturado no `sdr-agent`
`supabase/functions/sdr-agent/index.ts`:
- Após `forced_tool` falhar:
  - Se erro estruturado = `booking_not_found` → recomputar policy com `active_booking=null` e re-rodar como `book_slot`.
  - Se erro = `slot_unavailable` (409 do Cal.com com motivo "no_available_users") → cair em `check_calendar` para reofertar.
  - Caso contrário → forçar `finalize({ decision: "send_message", message: <pedido de desculpas + pergunta de novo horário> })` **mesmo com `finalize_allowed=false`**. Garante que **nunca** terminamos em silêncio quando o lead está esperando.
- Adicionar guard no fim do loop: se nenhum step gerou `decision=send_message|offer_slots|...` e há inbound não respondido, escalar para `escalate_to_human` em vez de `silence`.

### 5. Reconciliação periódica (defesa em profundidade)
Novo cron leve `calcom-reconcile-bookings` (a cada 15min):
- Para cada `bookings.status IN ('confirmed','pending','rescheduled')` cujo `updated_at > 1h`, faz `GET /v2/bookings/{uid}` e aplica `upsertBookingFromCalcom` (ou marca cancelled se 404). Evita que UIDs órfãos fiquem aparecendo como booking ativo no policy engine.

### 6. Testes
- `calcom-booking-reschedule_test.ts`: stub do Cal.com retornando 404 e 409 — verifica que (a) `bookings.status` é atualizado, (b) response inclui `calcom_status`/`calcom_body`, (c) idempotência reusa o registro `failed` corretamente.
- `sdr-agent_test.ts`: novo cenário "reschedule falha 3x" → verifica que o run termina em `send_message` (nunca em `silence`).

### 7. Limpeza pontual deste lead (durante o deploy)
- `UPDATE calendar_actions SET status='failed' WHERE lead_id='a6ba77a3…' AND status='pending'` (já está, mas garantir).
- Validar o uid `b4ADMYcJmojrtEP57rSuR5` direto no Cal.com via novo log da etapa 1; se 404, marcar `bookings` local como cancelled e disparar `sdr-agent` manualmente para o lead receber resposta.

## Critérios de aceite
1. Nova chamada falha do Cal.com aparece em `calendar_actions.response_payload` com `{calcom_status, calcom_body}` legível.
2. Quando o booking não existe mais no Cal.com, o SDR converte automaticamente para `book_slot` sem intervenção.
3. Nenhum run termina com `decision=silence` quando o último step é um `tool_call` que falhou — sempre vira `send_message` ou `escalate_to_human`.
4. Lead `a6ba77a3…` recebe resposta dentro de 1 minuto após o redeploy.

## O que não muda
- Pipeline determinístico (classifier → extractor → policy) permanece intacto.
- Schema de `bookings` e `calendar_actions` sem alterações (apenas mais campos preenchidos em `response_payload`).

Confirma esse plano para eu implementar?