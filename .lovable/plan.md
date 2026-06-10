## Diagnóstico

A reunião do Eduardo segue confirmada no Cal.com porque a chamada de cancelamento do nosso código usa o método HTTP errado:

- **Atual**: `DELETE https://api.cal.com/v2/bookings/{uid}/cancel` com `cal-api-version: 2024-04-15`
- **Correto** (Cal.com v2): `POST https://api.cal.com/v2/bookings/{uid}/cancel` com header `cal-api-version: 2024-08-13` e body `{ "cancellationReason": "..." }`

Como o código atual ignora o status HTTP da resposta (fire-and-forget), o erro nunca apareceu nos logs. O slot_hold foi marcado como `cancelled` no nosso banco e a mensagem de sistema foi inserida, mas o evento no Cal.com nunca foi cancelado.

Mesmo bug existe em 3 lugares: `inbound-webhook` branches `cancel`, `reschedule` e os cleanups de bookings "órfãs".

## O que vou mudar

### 1. `supabase/functions/_shared/calcom.ts` — novo helper compartilhado

Criar `cancelCalcomBooking(uid, reason)` e `cancelCalcomReservation(uid)` que:
- Usam método/versão corretos
- Logam `status`, `ok`, e corpo da resposta
- Retornam `{ ok, status, body, error? }` para o caller decidir

### 2. `supabase/functions/inbound-webhook/index.ts`

Substituir as 3 chamadas inline de cancel (branches `cancel`, `reschedule`, cleanup de bookings órfãs) pelas funções do helper. Logar resultado.

Adicionar uma verificação: se o cancel no Cal.com **falhar**, registrar atividade `alert` ("⚠️ Cancelamento no Cal.com falhou — verificar manualmente") em vez de só marcar `cancelled` localmente.

### 3. `supabase/functions/calcom-confirm-booking/index.ts`

Usar o mesmo helper para `cancelCalcomReservation` no loop dos `otherHolds` (atualmente DELETE — está correto para reservations, mas centraliza logging).

### 4. Fix one-shot para o Eduardo

Após corrigir o código, rodar uma chamada manual via `code--exec` para cancelar o booking `p3cQruwp2S8Xw4ukzgVfyx` no Cal.com agora, usando `CALCOM_API_KEY` já presente nos secrets. Confirmar pelo screenshot do painel ou via GET no booking.

## Fora de escopo

- Recriar a tabela `bookings` retroativamente (vazia para este lead porque o webhook `calcom-webhook` não populou). Atacamos isso em outra rodada.
- Mudar a UI para mostrar status de cancelamento Cal.com em tempo real.

## Ordem

1. Criar `_shared/calcom.ts` (helper + logging)
2. Refatorar `inbound-webhook` (3 chamadas)
3. Refatorar `calcom-confirm-booking`
4. Deploy `inbound-webhook` e `calcom-confirm-booking`
5. Exec one-shot cancelando o booking do Eduardo no Cal.com
6. Verificar painel Cal.com (você confirma)
