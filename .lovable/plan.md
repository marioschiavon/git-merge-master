## Problema

O lead Juliano confirmou para 03/jul 16:00 e logo pediu para mudar para 16:45. O agente SDR não tinha como remarcar — só sabia `book_slot` (criar nova reserva). Resultado: pediu "desculpas, instabilidade no sistema" e não fez nada.

As edge functions `calcom-booking-reschedule` e `calcom-booking-cancel` existem e funcionam; o `execute-action` também já tem os handlers `reschedule_booking` e `cancel_booking`. **O elo que falta é o agente SDR não enxergar/decidir essas ações.**

## O que vou fazer

### 1. Dar ao agente SDR visibilidade do booking ativo
Em `sdr-agent/index.ts → loadContext`, carregar `bookings` ativos (status `confirmed`/`pending`/`rescheduled`) com `calcom_booking_uid` e `scheduled_at`, e expor isso no system prompt em uma seção "Reserva ativa". Hoje só `slot_holds` aparecem, então o agente "esquece" que já existe agendamento confirmado.

### 2. Adicionar decisões de remarcar e cancelar na tool `finalize`
Acrescentar dois valores ao enum `decision`:
- `reschedule_booking` — campos: `slot_start` (novo horário ISO), `reason`, `message` (confirmação), `channel`.
- `cancel_booking` — campos: `reason`, `message`, `channel`.

### 3. Implementar as ações no modo `live` (bloco que hoje só trata `book_slot`)
- **reschedule_booking**: localiza o booking ativo (`bookings.calcom_booking_uid`), invoca `execute-action` com `action_type: "reschedule_booking"` e `params: { booking_uid, start: slot_start, reason }`; em seguida envia a mensagem de confirmação via `send_reply`. Em caso de erro, usa o mesmo padrão de fallback do `book_slot` (handoff + mensagem amigável).
- **cancel_booking**: idem, com `action_type: "cancel_booking"` e `params: { booking_uid, reason }`, depois mensagem.

### 4. Regras no system prompt
Incluir no bloco "Regras críticas":
- Se existe Reserva ativa e o lead pede mudança de horário → usar `reschedule_booking` (NUNCA criar nova reserva com `book_slot` em paralelo).
- Se o lead pede para desmarcar/cancelar → primeiro tentar `offer_reschedule` curto (1 mensagem) só se fizer sentido, senão `cancel_booking`.
- Para `reschedule_booking`, validar disponibilidade com `check_calendar` antes — passar a janela do dia/horário pedido — e só finalizar se o slot estiver livre. Se não estiver, oferecer alternativas com `offer_slots`.

### 5. Corrigir o caso do Juliano agora
Chamar `calcom-booking-reschedule` para o booking `tK9LvsL6SpdJdzm6q6ARrN` movendo para 03/jul 16:45 BRT (19:45 UTC) e enviar uma mensagem WhatsApp curta confirmando.

## Verificação

- Inbound de teste tipo "pode mudar para tal horário?" deve resultar em: 1 chamada `calcom-booking-reschedule` bem-sucedida, registro novo em `bookings` com `previous_booking_id`, antigo virando `rescheduled`, e 1 mensagem outbound confirmando o novo horário.
- Inbound "preciso cancelar" deve resultar em booking `cancelled` no Cal.com + DB + mensagem outbound.
- `sdr_agent_runs.final_output.live.ok = true` nos dois cenários.

## Fora do escopo

- Não vou mexer em `calcom-booking-reschedule/cancel/create/confirm` em si — já estão corretos.
- Não vou alterar `inbound-webhook`, `calcom-webhook` nem fluxo de cadência.
