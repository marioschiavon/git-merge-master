## O que será entregue

### 1. Card "Reunião agendada" (acima do card de slots reservados, em Conversas e em Detalhes do Lead)
Cores e ações por status:
- ✅ Confirmada (verde) — data/hora BRT + botões "Abrir Meet", "Remarcar", "Cancelar".
- 🔄 Remarcada (amarelo) — nova data + nota da data anterior.
- ❌ Cancelada (cinza) — data prevista riscada + momento do cancelamento.
- ⚠️ No-show (vermelho) — data + ação "Recuperar lead".
- ✔️ Concluída (cinza-azul) — data realizada.

### 2. Marcadores de evento dentro do histórico de mensagens
Estilo timeline (centralizado, pill cinza, sem balão), inseridos automaticamente quando o booking muda:
- `📅 Reunião confirmada — ter 09/06 17:30`
- `🔄 Remarcada para qui 12/06 14:00 (antes: ter 09/06 17:30)`
- `❌ Reunião cancelada`
- `⚠️ Lead não compareceu`
- `✔️ Reunião concluída`

## Detalhes técnicos

### Backend (Supabase Edge Functions)
- Novo helper em `supabase/functions/_shared/booking-messages.ts`:
  - `insertBookingSystemMessage(supabase, { lead_id, company_id, event_type, booking, previous?, channel? })`.
  - Encontra a conversa mais recente do lead, ou cria uma nova com `channel = lead.preferred_channel ?? 'whatsapp'`.
  - Insere `messages` com `direction = 'system'`, `content` em pt-BR, `metadata = { event_type, booking_uid, scheduled_at, previous_scheduled_at? }`.
- Edita `supabase/functions/calcom-webhook/index.ts`: chama o helper dentro do `switch` para `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `BOOKING_NO_SHOW_UPDATED`, `MEETING_ENDED`. Passa `previous = old scheduled_at` em RESCHEDULED (pega o valor anterior do `bookings` antes do upsert).
- Edita `supabase/functions/calcom-confirm-booking/index.ts`: chama o helper com `event_type = 'BOOKING_CREATED'` para feedback imediato (sem aguardar webhook Cal.com).
- Sem migração: a coluna `messages.direction` é `text` sem CHECK, aceita `'system'`. RLS continua válida (acesso via `conversations.company_id`).

### Frontend
- `src/hooks/useLeadBooking.ts` — query do booking mais relevante do lead (último não-cancelado; se nada, último qualquer). Refetch 30s.
- `src/components/BookingCard.tsx` — variantes por status; integra `useCancelBooking` e `useRescheduleBooking` (já existentes). Diálogo de remarcar usa `<input type="datetime-local">`.
- `src/pages/Conversations.tsx`:
  - Renderiza `<BookingCard leadId=... />` antes do `<SlotHoldsCard>`.
  - Quando `msg.direction === 'system'`, renderiza em layout centralizado com ícone derivado de `msg.metadata.event_type`.
- `src/components/LeadDetail.tsx`: nova seção "Agendamento" com `<BookingCard leadId=lead.id />` antes da seção "Horários oferecidos".

### Estrutura de uma system message gerada
```text
content: "Reunião confirmada para terça, 09/06 às 17:30"
metadata: {
  event_type: "booking_created" | "booking_rescheduled" | "booking_cancelled" | "booking_no_show" | "booking_completed",
  booking_uid: "aZMyNkYziaHGrsJ94BKPQh",
  scheduled_at: "2026-06-09T20:30:00.000Z",
  previous_scheduled_at: "2026-06-09T19:30:00.000Z" // só em reschedule
}
```

## Fora de escopo
- Calendário visual no diálogo de remarcar (usa `datetime-local` simples).
- Notificação por email/push ao operador SDR.
- Multi-conversa: usa a conversa mais recente do lead; cria nova se não houver.
