## Diagnóstico

Lead `a6ba77a3…` está aguardando resposta desde 14:13. A última run do `sdr-agent` (id `71388998…`, iniciada 14:13:30) ficou `status='running'` para sempre — boot ok, logou o estado e morreu sem enviar mensagem nem gravar erro.

Sequência reconstruída:

1. 14:11:47 — booking **confirmado** para 18/jun 17:45 (BRT).
2. 14:12:16 — lead: *"Esse horário não consigo. Quais outros horários você tem dia 18?"*
3. 14:13:01 — agent **ignorou** o booking ativo, tratou como novo agendamento e ofereceu **18/jun 09:00** (criou `slot_hold` 951685a0 às 12:00 UTC).
4. 14:13:12 — lead: *"Sim"*.
5. 14:13:30 — agent entra com `stage=scheduling_confirming_now`, `pending=book_then_confirm` → tenta `book_slot` num lead que **já tem booking confirmado**. `assertCanBook` rejeita, o loop não tem saída válida (não está em `rescheduling`), atinge limite/timeout e morre sem `finalize` nem mensagem.

Duas falhas combinadas:

- **A state machine não reconhece "quero outro horário" pós-confirmação como reschedule.** Continua em `scheduling_confirming_now` em vez de transicionar para `rescheduling`.
- **Quando `book_slot` falha por já existir booking, o agent não tem fallback** (nem converte em `reschedule_booking`, nem aborta com mensagem ao lead, nem marca a run como `failed`).

## Plano

### 1. Detectar intenção de reschedule mesmo sem palavra "remarcar"

Em `sdr-agent/index.ts`, no resolver de estado pré-LLM (ou no `state-machine.ts`):
- Se existe booking `confirmed` ativo **e** a última mensagem inbound contém sinais de troca ("outro", "outros horários", "não consigo", "não posso", "muda", "troca", "antes", "depois", "mais cedo", "mais tarde") → forçar transição para `rescheduling` e instruir o LLM a usar `reschedule_booking` (não `book_slot`).
- Reforçar no system prompt: *"Se já existe booking confirmado, NUNCA chame `book_slot`. Use `reschedule_booking` ou `cancel_booking`."*

### 2. Guard determinístico no `book_slot`

Em `_shared/booking-guards.ts` (`assertCanBook`): se já há booking `confirmed` para o lead, **retornar erro estruturado** `{ code: "ACTIVE_BOOKING_EXISTS", existing_booking_id, scheduled_at }`. A tool propaga esse erro como `tool_result` para o LLM, que é instruído a:
- chamar `reschedule_booking` com o novo slot, ou
- responder ao lead pedindo confirmação de troca.

### 3. Safety net: run não pode ficar `running` para sempre

Em `sdr-agent/index.ts`:
- `try/catch/finally` ao redor do loop principal: em qualquer exceção/timeout, gravar `sdr_agent_runs.status='failed'` + `error` antes de retornar.
- Limite de steps explícito (ex.: 8) com fallback: se atingido sem `finalize`, enviar mensagem genérica *"Só um instante, vou confirmar e te respondo."* e marcar `status='failed'` para auditoria.
- Adicionar `setTimeout` watchdog (ex.: 25s) que aborta o loop e força fallback.

### 4. Destravar a run atual e responder o lead

Script único de cleanup:
- `UPDATE sdr_agent_runs SET status='failed', error='stuck_after_book_conflict' WHERE id='71388998…'`.
- Expirar o `slot_hold` órfão `951685a0` (`status='expired'`).
- Disparar `sdr-agent` manualmente para o lead, agora com os fixes em #1–#3, para que ele responda algo como: *"Você já tem reunião confirmada para 18/jun às 17:45. Quer que eu remarque para outro horário no dia 18? Tenho [opções]."*

### 5. Eval mínima (mesmo PR)

Adicionar cenário ao `sdr-agent_test.ts` (já planejado):
- Booking confirmado existe + lead pede "outros horários dia X" → agent oferece slots e usa `reschedule_booking`, **nunca** `book_slot`. Run termina com `status='succeeded'` e exatamente 1 mensagem outbound.

## Arquivos

- `supabase/functions/sdr-agent/index.ts` — detecção de reschedule, watchdog, fallback, `finally` que grava `failed`.
- `supabase/functions/_shared/state-machine.ts` — transição `booking_confirmed → rescheduling` por sinais textuais.
- `supabase/functions/_shared/booking-guards.ts` — erro estruturado `ACTIVE_BOOKING_EXISTS`.
- `supabase/functions/sdr-agent/sdr-agent_test.ts` — novo cenário.
- Migration de housekeeping (one-off) para o lead travado.

## Critérios de validação

1. Run `71388998…` vira `failed` e o lead recebe resposta coerente.
2. Repetir o fluxo "outros horários dia X" pós-confirmação → 1 mensagem de reagendamento, sem nova run travada.
3. `sdr_agent_runs.status='running'` há mais de 60s passa a ser zero em condições normais.
