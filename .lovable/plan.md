## O que aconteceu

Na conversa do lead `eu@julianocarneiro.com.br`, o `execute-action` cron disparou **5 mensagens em rajada** às 13:20 — quando o esperado era apenas o acknowledge do cancelamento que ele fez pelo link do e-mail:

```
13:20:03  outbound  Reunião confirmada 18/06 17:00   (booking i9cD… já cancelada)
13:20:04  outbound  Reunião confirmada 18/06 09:45   (booking 58uk… já cancelada)
13:20:17  outbound  Vi que você cancelou…            (ack do reschedule interno)
13:20:18  outbound  Reunião confirmada 15/06 17:00   (booking rboj… já cancelada)
13:20:28  outbound  Vi aqui que você cancelou…       (ack do cancel via link – este é o único correto)
```

## Causas (encadeadas)

### 1) `calendar_actions` sem `provider_booking_uid` → webhook trata todo BOOKING_CREATED como órfão
Investigação na tabela:

```
action_type | status | provider_booking_uid | resp_uid
book        | ok     | (null)               | (null)
cancel      | failed | i9cD…                | (null)
```

O SDR invoca `calcom-confirm-booking`, que devolve `{ booking: bookingData.data, … }`. O `uid` real do Cal.com fica em `data.uid`, mas o `sdr-agent` extrai com:

```ts
const bookingUid = booking?.booking?.calcom_booking_uid ?? booking?.calcom_booking_uid ?? null;
```

Nenhuma das duas chaves existe → `markCalendarActionOk` grava `provider_booking_uid = null`. Consequência: o `calcom-webhook` faz `select … where provider_booking_uid = uid and status = 'ok'` e não encontra → marca o booking como `source='webhook'` (órfão) → enfileira `send_booking_confirmation`. Ocorreu nas 3 reservas criadas pelo SDR durante a conversa.

### 2) `execute-action.send_booking_confirmation` não valida estado atual do booking
Quando o cron finalmente roda (~4 min depois), envia a confirmação mesmo que o booking já esteja `cancelled` ou tenha sido substituído por outro mais recente. Por isso saíram 3 "Reunião confirmada" para horários já cancelados.

### 3) Reschedule não estampa `cancellation_source` no booking antigo
Quando o SDR reagenda, o Cal.com emite **BOOKING_CANCELLED** do antigo. O webhook só pula o ack quando vê `bookings.cancellation_source ≠ 'lead'` (estampado em até 5 min). O `calcom-booking-reschedule` não escreve esse marcador → ack vira pending → resultou no 2º "Vi que você cancelou…" enviado erroneamente.

### 4) Sem coalescência por lead na fila
O `execute-action` consome todos os pendentes do lead em ordem, sem suprimir mensagens redundantes/superadas no mesmo flush.

## Correções

### A. Capturar o `uid` do Cal.com no SDR (raiz dos problemas 1 e 2)
- `sdr-agent/index.ts` (book): trocar a extração para `booking?.booking?.uid ?? booking?.booking?.calcom_booking_uid ?? booking?.calcom_booking_uid ?? null`.
- `sdr-agent/index.ts` (reschedule): mesma normalização em `newUid`.
- Bônus defensivo em `calcom-confirm-booking/index.ts`: expor também `booking_uid` e `calcom_booking_uid` no JSON de retorno para evitar contrato frágil.

Efeito: `calendar_actions.provider_booking_uid` passa a ser preenchido → webhook reconcilia BOOKING_CREATED → não vira órfão → não enfileira `send_booking_confirmation` redundante.

### B. Estampar origem na remarcação (problema 3)
Em `calcom-booking-reschedule/index.ts`, antes de chamar Cal.com, atualizar a linha do booking **antigo** com `cancellation_source='sdr_reschedule'` e `cancellation_requested_at=now()`, e na linha do booking **novo** registrar `source='sdr_agent'` após o upsert. Assim o `calcom-webhook` (que já tem o filtro de 5 min) suprime o ack do cancelamento implícito.

### C. Hardening em `execute-action.send_booking_confirmation`
Antes de enviar, recarregar o booking e abortar quando:
- `booking.status` ∈ {`cancelled`, `rescheduled`, `no_show`}; ou
- existir outra reserva mais recente (`scheduled_at`/`updated_at`) para o mesmo `lead_id` em estado ativo; ou
- já houver mensagem outbound nos últimos 10 min com `metadata.action='send_booking_confirmation'` ou `metadata.booking_uid=<uid>` (idempotência local). Pular registra `note` em `lead_activities` e marca a action como `done` com `result.skipped=true`.

### D. Hardening em `execute-action.acknowledge_cancellation`
Manter os dois guards atuais e adicionar:
- pular se já existe outro `acknowledge_cancellation` `done` para o mesmo `lead_id` nas últimas 24 h (independente do `booking_uid`) — evita o caso "reschedule + cancel real" gerar dois acks.

### E. Coalescência no flush do `execute-action`
Ao carregar o lote pendente do lead, ordenar por `scheduled_for`/`created_at` e, **antes de executar**, descartar (marcar `skipped`) qualquer `send_booking_confirmation` cujo `booking_uid` não seja o mais recente da fila/lead. Idem manter apenas o `acknowledge_cancellation` mais recente.

### F. Verificação
1. Reproduzir cenário shadow: criar → reagendar → cancelar via link, assertando exatamente 1 outbound (`acknowledge_cancellation`) e 0 confirmações redundantes.
2. Conferir `calendar_actions.provider_booking_uid` populado após cada `book`/`reschedule`.
3. Inspecionar `lead_action_queue` — itens redundantes devem aparecer com `status='done'` e `result.skipped=true`.

## Não incluso (proposta separada, se quiser)

- Backfill dos `calendar_actions` órfãos antigos.
- Reduzir intervalo do cron `execute-action` para 1 min (hoje ~4 min agrava o efeito rajada).
