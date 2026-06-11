## Problema

Lead `cecb670b` tinha reunião confirmada para 12/06 16:45 (`ncUQNz18zdi1S4WLECWRyU`). Às 16:19 ele disse "vou mudar de país e não tenho mais interesse". O SDR respondeu certo (pausou contato), mas a reunião **continuou ativa no Cal.com**.

## Causa

A mensagem foi classificada como `rejection / not_interested` → AI retorna `parsed.action = "pause"` (não `cancel`).

No branch `pause` (linhas 1560-1583 de `supabase/functions/inbound-webhook/index.ts`), o código:
- cancela `slot_holds` com `status = 'held'` no Cal.com (reservas) ✅
- pausa o enrollment ✅
- **NÃO cancela bookings confirmadas** ❌

Resultado: a booking confirmada permanece "scheduled" no Cal.com mesmo o lead tendo desistido.

## Solução

No branch `pause` de `supabase/functions/inbound-webhook/index.ts`, depois de cancelar os `slot_holds` held, adicionar o mesmo bloco usado no branch `cancel` (linhas 1321-1334) que:

1. Busca `bookings` ativas do lead (`status != 'cancelled'`).
2. Para cada uma, chama `cancelCalcomBooking(uid, "Lead perdeu interesse")`.
3. Atualiza `bookings.status = 'cancelled'` no banco.
4. Insere `insertBookingSystemMessage` com `event_type: 'booking_cancelled'` para o histórico da conversa mostrar "❌ Reunião cancelada".
5. Se algum cancel falhar, registra `lead_activity` tipo `alert` (mesmo padrão do branch cancel).

Também cancelar `slot_holds` com `status = 'confirmed'` (não só `held`), por consistência.

### Validação

1. Redeploy `inbound-webhook`.
2. Smoke test manual via UI: criar booking confirmada → enviar "não tenho mais interesse" como lead → conferir:
   - Mensagem system "❌ Reunião cancelada" na conversa.
   - `bookings.status = 'cancelled'` no banco.
   - `GET /v2/bookings/{uid}` no Cal.com retornando `status: "cancelled"`.
3. Confirmar que o fluxo de soft-cancel (reschedule) e hard-cancel explícito continuam funcionando.

### Arquivos

- `supabase/functions/inbound-webhook/index.ts` (apenas o branch `pause`, ~20 linhas adicionadas)
