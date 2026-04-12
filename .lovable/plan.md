

## Migrar Cal.com API de v1 para v2

### Problema
A API v1 do Cal.com foi descontinuada (retorna HTTP 410). Por isso, a função `calcom-slots` falha e o sistema cai no fallback de enviar apenas o link de agendamento em vez de oferecer 2 horários específicos.

### Mudanças

**1. `supabase/functions/calcom-slots/index.ts`** — Migrar para API v2

- URL: `https://api.cal.com/v2/slots` com query params `eventTypeId`, `start`, `end`
- Auth: header `Authorization: Bearer <CALCOM_API_KEY>` (em vez de query param `apiKey`)
- Header obrigatório: `cal-api-version: 2024-09-04`
- Response v2: `{ status: "success", data: { "2050-09-05": [{ start: "..." }], ... } }` — campo `start` em vez de `time`
- Após selecionar 2 slots, usar **Reserve a Slot** (`POST /v2/slots/reservations`) para reservar cada um no Cal.com por 120 minutos, salvando o `reservationUid` no campo `cal_booking_uid` da tabela `slot_holds`

**2. `supabase/functions/expire-slot-holds/index.ts`** — Migrar cancelamento para v2

- Cancelamento de reserva v2: `DELETE https://api.cal.com/v2/slots/reservations/{reservationUid}` com header `Authorization: Bearer` e `cal-api-version: 2024-09-04` (em vez de v1 `/bookings/cancel`)

### Escopo
- 2 edge functions atualizadas
- Nenhuma mudança de banco ou UI

