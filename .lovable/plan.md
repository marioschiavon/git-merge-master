## Contexto do que aconteceu com Juliano Carneiro

Da análise do banco e do código:

1. **Cancelamento não refletiu** — quando o lead pediu "Preciso remarcar.", a função `inbound-webhook` (ação `reschedule`) cancela a reserva na Cal.com via DELETE, mas **não atualiza a tabela `bookings` localmente** (espera o webhook BOOKING_CANCELLED). Por isso a UI continuou mostrando "agendada" por minutos. Além disso, o action enum da IA **não tem `cancel`** — pedidos de cancelamento puro caem em `pause` (que apenas pausa a cadência, sem cancelar a reunião).

2. **Slots muito próximos** — `calcom-slots` busca slots em `now → now + 7 dias`, sem mínimo de antecedência. Por isso ofereceu hoje 17:30 (em ~30 min) e amanhã.

3. **Pedido "semana que vem" ignorado** — `extractDateTimeFromText` não reconhece "semana que vem / próxima semana / depois do dia X". Mesmo quando o `classify-intent` extrai `datetime: "next week"`, ninguém propaga isso para `calcom-slots`, que não aceita parâmetro de janela.

4. **Holds remanescentes após cancel/reschedule** — `confirm-booking` já limpa irmãos corretamente. Mas quando o lead cancela ou pede para remarcar, holds antigos `status='held'` ficam pendurados (e novas ofertas são criadas em cima). Verificado no banco: existem 2 holds `held` órfãos após o booking ter sido cancelado.

## Mudanças

### 1. Reconhecer "cancel" como ação distinta (inbound-webhook)
- Adicionar `"cancel"` ao enum de ações da IA em `supabase/functions/inbound-webhook/index.ts` (linha ~491) com descrição "lead quer cancelar a reunião sem remarcar".
- Implementar handler `case "cancel"`: busca último `bookings` ativo do lead → chama `calcom-booking-cancel` com o `calcom_booking_uid` → atualiza `slot_holds` do lead com `status='held'` para `cancelled` → marca `cadence_enrollments.meeting_scheduled=false, status='cancelled'` → envia resposta empática de despedida + insere `system message` via `insertBookingSystemMessage('booking_cancelled')`.
- Ajustar prompt do classificador inline para distinguir: lead diz "preciso remarcar/mudar horário" → `reschedule`; lead diz "não vou poder / cancela / não tenho mais interesse na reunião" → `cancel`.

### 2. Reschedule deve atualizar `bookings` imediatamente
- No `case "reschedule"` (linha ~787) de `inbound-webhook`, após DELETE bem-sucedido na Cal.com, fazer `UPDATE bookings SET status='cancelled', updated_at=now() WHERE calcom_booking_uid = ? AND status != 'cancelled'`.
- Mesmo tratamento no novo `case "cancel"`.
- Garante que a UI (BookingCard, hook `useLeadBooking`) reflita imediatamente, sem depender do webhook.

### 3. Limpar `slot_holds` antigos em cancel/reschedule
- No início dos handlers `reschedule` e `cancel`, fazer `UPDATE slot_holds SET status='cancelled' WHERE lead_id = ? AND status = 'held'` ANTES de criar novos holds.
- Para cada hold que tinha `cal_booking_uid`, tentar DELETE na Cal.com (`/v2/slots/reservations/{uid}`) — best-effort, logar falha.

### 4. Antecedência mínima e diversidade de slots (`calcom-slots`)
- Adicionar constante `MIN_LEAD_HOURS = 24` (configurável via env `CALCOM_MIN_LEAD_HOURS`).
- `startDate = now + MIN_LEAD_HOURS`.
- Aumentar janela default para 14 dias (`endDate = startDate + 14d`), para ter mais flexibilidade.
- Aceitar dois novos parâmetros no body: `start_after` (ISO) e `end_before` (ISO). Quando presentes, sobrescrevem `startDate`/`endDate`, respeitando ainda o `MIN_LEAD_HOURS`.
- Filtrar slots para garantir distância mínima entre os 2 escolhidos: pelo menos **2 dias úteis de diferença** entre o slot 1 e o slot 2 (e nunca o mesmo dia). Se só houver 1 slot na janela, retorna mensagem clara.

### 5. Extrair preferência de data da mensagem do lead
- Em `supabase/functions/inbound-webhook/index.ts`, criar nova função `extractDateRangeFromText(text)` que retorna `{ start_after?: string, end_before?: string }`:
  - `"semana que vem" | "próxima semana"` → próxima segunda 00:00 BRT até próximo domingo 23:59 BRT.
  - `"daqui (a|à)? X dias"` → +X dias 00:00.
  - `"depois do dia DD"` → DD/mês_corrente (ou próximo) 00:00.
  - `"depois do dia DD/MM"` → DD/MM 00:00.
  - `"próxima (segunda|terça|...)"` → próxima ocorrência do weekday 00:00 ~ +1 dia 23:59.
  - `"no fim do mês"` → dia 25 do mês corrente em diante.
- Quando o lead pede `reschedule` ou `schedule` e a função retorna range, repassar para `calcom-slots` via `start_after`/`end_before`.
- Usar também as `entities.datetime` que o `classify-intent` já popula: se for "next week"/"this week", traduzir para range BRT antes de chamar `calcom-slots`.

### 6. Propagar preferência no `execute-action` (suggest_meeting_times)
- Em `supabase/functions/execute-action/index.ts`, no handler `suggest_meeting_times`, ler `last_intent.entities` do lead (último `lead_intents_log`) e converter `datetime` textual em `start_after`/`end_before` antes de chamar `calcom-slots`.

### 7. Mensagem de sistema na conversa
- Quando o cancel/reschedule for executado automaticamente pela IA (caso 1/2), inserir `system message` via helper `insertBookingSystemMessage` (`booking_cancelled` ou `booking_rescheduled`), para o operador ver o evento na timeline da conversa.

### Fora de escopo
- Reescrever a regra `intent_action_rules` (`scheduling/cancel_request`) — o fluxo crítico é o inline `inbound-webhook`, que é o que efetivamente roda na conversa. Manteremos a regra como fallback para casos enfileirados.
- Detecção de feriados nos slots (BRT) — pode entrar em iteração futura.
- UI para o SDR editar `MIN_LEAD_HOURS` por empresa — fica via env por enquanto.

## Detalhes técnicos resumidos

```text
inbound-webhook
├── enum.action += "cancel"
├── extractDateRangeFromText(text) → {start_after?, end_before?}
├── case "reschedule":
│     UPDATE slot_holds SET status='cancelled' WHERE lead_id AND status='held'
│     DELETE Cal.com booking
│     UPDATE bookings SET status='cancelled'
│     insertBookingSystemMessage('booking_rescheduled' or 'booking_cancelled')
│     invoke calcom-slots {start_after, end_before}
└── case "cancel":     (novo)
      similar a reschedule, sem oferecer slots novos

calcom-slots
├── MIN_LEAD_HOURS = env || 24
├── body += {start_after?, end_before?}
├── janela = max(now+MIN_LEAD_HOURS, start_after) → end_before || +14d
├── seleção: 2 slots em dias distintos, separados por ≥2 dias úteis

execute-action.suggest_meeting_times
└── lê last lead_intents_log.entities.datetime → range → calcom-slots
```

Tudo isso fechado, a conversa com Juliano teria: ao "Preciso remarcar." → cancela booking + limpa holds + oferece slots da semana que vem (mín 24h adiante, 2 dias úteis de distância entre eles), e o card de "Agendamento" some/mostra "cancelada" imediatamente.