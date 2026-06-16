Diagnóstico objetivo

O erro atual não vem do Cal.com e não é causado pelo Human in the Loop.

O 409 está sendo criado internamente pelo nosso próprio controle de idempotência:

```text
sdr-agent cria calendar_actions com status=pending
       ↓
sdr-agent chama calcom-booking-cancel com a mesma idempotency_key
       ↓
calcom-booking-cancel tenta criar/claimar a mesma ação
       ↓
como já existe pending, responde 409 in_flight
       ↓
sdr-agent interpreta como falha real: cancel_failed http=409 cal_status=null
```

Evidência no banco:

- `calendar_actions` tem cancelamento do booking `6eaKUU3RBht1Z38WyYQUn4` com `status=failed`
- `error_message = cancel_failed http=409 cal_status=null msg=HTTP 409`
- `cal_status=null`, ou seja: não chegou como erro real do Cal.com
- a reunião ainda está `status=confirmed`

Por que isso voltou a quebrar

O fluxo de remarcação já tinha sido ajustado para não fazer dupla trava: o `sdr-agent` deixa a função de remarcação cuidar da idempotência.

O fluxo de cancelamento ficou inconsistente: o `sdr-agent` ainda faz o claim antes e depois chama `calcom-booking-cancel`, que também faz claim. Isso gera o 409 sempre que o cancelamento usa essa rota.

Plano de correção

1. Ajustar `sdr-agent/index.ts`
   - Remover o `claimCalendarAction` interno do bloco `cancel_booking`.
   - Fazer o cancelamento seguir a mesma lógica da remarcação: a função `calcom-booking-cancel` será a única dona da idempotência.
   - Manter a geração da `idempotency_key`, mas apenas passar para a função de cancelamento.
   - Remover `markCalendarActionOk/Failed` desse bloco, porque quem deve marcar sucesso/falha é `calcom-booking-cancel`.

2. Melhorar o tratamento de 409 real em `sdr-agent/index.ts`
   - Se `calcom-booking-cancel` retornar `in_flight: true`, tratar como trava temporária interna, não como “Cal.com falhou”.
   - Fazer retry curto e, se persistir, devolver mensagem técnica controlada sem marcar como erro de Cal.com.
   - Registrar no log o body completo quando `http=409`, para não aparecer mais `null`.

3. Reforçar `calcom-booking-cancel/index.ts`
   - Manter essa função como fonte única de verdade para:
     - claim de idempotência
     - chamada real ao Cal.com
     - atualização de `bookings` para `cancelled`
     - liberação do `slot_holds`
     - gravação de `calendar_actions`
   - Ajustar a resposta de `pending/in_flight` para incluir `error_code: "in_flight"` e uma mensagem clara.

4. Validar com o lead afetado
   - Reexecutar o cancelamento do booking `6eaKUU3RBht1Z38WyYQUn4`.
   - Confirmar no banco que:
     - `bookings.status = cancelled`
     - `slot_holds.status = released` para o horário da reunião
     - `calendar_actions.status = ok`
   - Verificar que o SDR responde ao lead com confirmação de cancelamento, não com “instabilidade”.

5. Verificação HITL
   - Confirmar que o Human in the Loop continua apenas aprovando a mensagem final.
   - A lógica de agenda continua sendo executada pelo mesmo SDR automático; o HITL não deve criar uma segunda rota nem repetir cancelamento/agendamento.

Resultado esperado

- Pedido do lead “cancele/desmarque” cancela a reunião automaticamente.
- Não haverá mais `Forced cancel_booking failed: ... http=409` por dupla idempotência.
- Erros reais do Cal.com continuarão aparecendo com `cal_status` e `cal_body`, separados de travas internas.