## Problema

Após o cancelamento, o lead enviou "Qual duração da reuniao?" e o SDR não respondeu. Logs mostram:

```
ERROR worker boot error: Uncaught SyntaxError: The requested module '../_shared/calcom.ts'
does not provide an export named 'cancelCalcomBooking'
```

A função `inbound-webhook` está quebrada no boot, ignorando todas as mensagens novas.

## Causa

Na última iteração eu criei `supabase/functions/_shared/calcom.ts` com `resolveEventTypeId` / `fetchEventTypeLengthMinutes` usando `code--write`, que sobrescreve o arquivo. O arquivo já existia e exportava também:

- `CALCOM_BOOKINGS_API_VERSION`, `CALCOM_EVENT_TYPES_API_VERSION`, `CALCOM_SLOTS_API_VERSION`
- `calcomHeaders`, `calcomFetch`
- `cancelCalcomBooking`, `cancelCalcomReservation`
- `corsHeaders`, `jsonResponse`
- `upsertBookingFromCalcom`

Esses símbolos são importados por `inbound-webhook/index.ts` e `calcom-confirm-booking/index.ts` — sem eles, o módulo não compila.

## Solução

Restaurar o conteúdo original de `supabase/functions/_shared/calcom.ts` (commit `8187c32`) e mesclar com as duas novas funções que adicionei (`resolveEventTypeId`, `fetchEventTypeLengthMinutes`), reutilizando a constante `CALCOM_EVENT_TYPES_API_VERSION` que já existia. Depois redeploy de `inbound-webhook`, `calcom-confirm-booking` e `calcom-slots`.

### Validação

- `inbound-webhook` boot sem `worker boot error`.
- Reenviar "Qual duração da reuniao?" no preview: SDR responde com a duração (clarifying bypass funciona de novo).
- Fluxos de cancel/reschedule continuam funcionando (smoke test via UI).
