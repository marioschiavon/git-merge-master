
## Situação atual

Quando o lead clica no link do email do Cal.com:

- **Reagendou** → `BOOKING_RESCHEDULED` chega no `calcom-webhook` → enfileira `send_booking_confirmation` com `rescheduled: true`. Isso gera uma mensagem extra desnecessária — o lead acabou de ver a nova confirmação na tela do Cal.com.
- **Cancelou** → `BOOKING_CANCELLED` chega no webhook → enfileira `offer_reschedule_instead`. O handler atual gera texto do tipo "ofereça remarcar **antes de cancelar definitivamente**", o que não faz sentido pós-cancelamento. Além disso, o webhook dispara igual quando quem cancela é o próprio SDR pelo app (via `calcom-booking-cancel`), gerando mensagem duplicada.

## O que mudar

### 1. Remover follow-up de remarcação (`supabase/functions/calcom-webhook/index.ts`)

No `switch` de `BOOKING_RESCHEDULED`, **parar de enfileirar** `send_booking_confirmation`. Manter a mensagem de sistema na conversa ("🔄 Reunião remarcada para X") e o `lead_activity`, mas nenhum outbound para o lead. O `BookingCard` da UI continua refletindo a nova data normalmente.

### 2. Distinguir quem cancelou (`supabase/functions/calcom-webhook/index.ts`)

Antes de enfileirar a ação no `BOOKING_CANCELLED`, identificar a origem:
- Ler campos que o Cal.com manda no payload: `payload.cancelledBy`, `payload.cancellation?.cancelledByEmail`, ou comparar com o e-mail do organizador/lead.
- Se cancelado pelo **lead** → enfileirar nova ação `acknowledge_cancellation` (item 3).
- Se cancelado pelo **organizador/SDR/app** → não enfileirar nada. Manter só a mensagem de sistema e a `lead_activity` (já existem hoje).

### 3. Novo handler `acknowledge_cancellation` (`supabase/functions/execute-action/index.ts`)

Substituir o `offer_reschedule_instead` no fluxo do webhook por um handler dedicado:

- `generateReply` com tom: "reconheça que o lead cancelou a reunião de [data], valide sem pressão ('imagino que algo tenha surgido / sem problemas') e pergunte se ele gostaria de remarcar — sem propor horários ainda, só abrir a porta."
- Canal = canal preferido do lead (`loadConversationChannel`).
- Registrar `lead_activity` tipo `meeting`: "🔄 Lead cancelou via Cal.com — follow-up de retomada enviado".
- Manter o handler `offer_reschedule_instead` antigo intocado (ele é usado em outro fluxo, quando o lead **pede** para cancelar via chat — pré-cancelamento).

### 4. Idempotência

Na inserção em `lead_action_queue` (webhook), checar se já existe row recente com `action_type = 'acknowledge_cancellation'` e `payload->>booking_uid` igual, com status `pending` ou `done` nas últimas 24h. Se sim, não enfileirar de novo. Evita follow-up duplicado se o Cal.com reenviar o webhook.

## Fora do escopo

- Não vou mexer em remarcação — nenhuma mensagem nova é disparada quando o lead remarca.
- Não vou criar nova tabela nem mexer em `slot_holds` / `bookings`.
- O `BookingCard`, o cron de fila e a UI continuam iguais.

## Verificação

1. Cancelar uma reserva de teste pelo link do email do Cal.com → webhook chega, `lead_action_queue` recebe `acknowledge_cancellation`, mensagem sai no canal preferido com tom de retomada ("vi que você cancelou… quer remarcar?").
2. Cancelar a mesma reserva pela UI do app → nenhuma mensagem nova ao lead, só a system message na conversa.
3. Remarcar pelo link do email → nenhuma mensagem nova ao lead; system message e `BookingCard` refletem a nova data.
