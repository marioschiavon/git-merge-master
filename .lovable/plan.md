# Bug: SDR agenda sozinho sem esperar confirmação

## Causa raiz

No `sdr-agent/index.ts` o LLM pode finalizar com `decision=book_slot` ou `decision=reschedule_booking` na **mesma jogada em que oferece o horário**. Hoje o prompt:

- Linha 516 manda: "se o lead pede para MUDAR o horário, use `reschedule_booking` com `slot_start` = novo horário ISO" — ou seja, o próprio agente escolhe e já confirma.
- Não existe regra que separe "oferecer" de "confirmar". Como o lead disse "tive uma emergência" + algo do tipo "pode ser outro dia", o modelo interpretou como autorização para remarcar e chamou `reschedule_booking` direto, gerando booking + link do Meet.

O mesmo vale para `book_slot` quando ainda não há reserva: nada impede o agente de pular `offer_slots` e ir direto a `book_slot`.

## Regra desejada

`book_slot` e `reschedule_booking` só podem ser chamados quando o **lead confirmou explicitamente** um horário específico que **já foi oferecido** num turno anterior (presente em `heldSlots` ou em `offered_slots` recentes). Caso contrário, o agente sempre passa por `offer_slots` e aguarda resposta.

## Mudanças

### 1. `supabase/functions/sdr-agent/index.ts` — guardas no executor

Antes de executar `book_slot` / `reschedule_booking`, validar:

- `fd.slot_start` precisa bater (±5 min) com algum slot em `heldSlots` (status `held`) **ou** com algum item de `lead_memory.offered_slots_pending`.
- A última mensagem inbound do lead precisa conter uma confirmação explícita: ou bate intent `book_slot`/`confirm` da última classificação em `lead_intents_log`, ou regex de confirmação (`/\b(confirmo|fechado|pode (ser|marcar)|esse mesmo|esse horário|tá bom|ok)\b/i`) referindo-se ao horário oferecido.
- Se falhar qualquer checagem: **não chamar `calcom-confirm-booking` nem `calcom-booking-reschedule`**. Em vez disso, converter para `offer_slots` (reaproveitando os 2 horários candidatos) e enviar uma mensagem pedindo confirmação ("Posso confirmar para X ou Y?").
- Logar no `sdr_agent_runs.metadata` o motivo do downgrade para visibilidade.

### 2. Prompt do sistema (mesmo arquivo, bloco de regras ~ linhas 495–520)

Reescrever as regras de agendamento:

- "NUNCA finalize com `book_slot` ou `reschedule_booking` num turno onde o lead ainda não escolheu um horário específico que você já tinha oferecido. Pedir desculpas, expressar empatia ou propor remarcação NÃO é confirmação."
- "Fluxo correto para remarcação: (a) reconheça o pedido, (b) finalize com `offer_slots` propondo no máximo 2 novos horários, (c) só use `reschedule_booking` no turno SEGUINTE, quando o lead responder escolhendo um dos horários."
- "Fluxo correto para primeiro agendamento: (a) `check_calendar` → (b) `offer_slots` com 2 horários → (c) aguardar resposta → (d) `book_slot` apenas quando o lead apontar um dos horários oferecidos (texto explícito tipo 'pode ser quarta 15h', 'esse mesmo', 'confirmo')."
- Remover a frase atual "use `decision=reschedule_booking` com `slot_start` = novo horário ISO" e substituir pela versão em dois turnos.

### 3. Memória — registrar slots oferecidos para o turno seguinte

No bloco que processa `offer_slots` (já existe), persistir os ISO oferecidos em `lead_memory.offered_slots_pending` com timestamp. O guarda em (1) usa essa lista para validar o `slot_start` recebido no turno seguinte. Limpar a lista quando: o lead aceitar (após booking), rejeitar explicitamente, ou após 24 h.

### 4. Caso lead pede para cancelar definitivamente

Mantém comportamento atual de `cancel_booking` (não precisa de slot a confirmar), apenas exige que a mensagem do lead contenha pedido claro de cancelamento (intent `cancel` ou regex). Sem regressão neste fluxo.

## Fora de escopo

- Não muda Cal.com, webhook, debounce nem oferta de horários.
- Não altera UI.
- Não mexe em `book_slot` chamado por confirmação manual humana.

## Verificação

- Reprocessar manualmente a conversa do lead `61a9b13e-93d9-404e-9ad9-a7a91b1c5bac` (via `curl_edge_functions` no `sdr-agent`) simulando "tive uma emergência" e conferir que o resultado é `offer_slots`, não `reschedule_booking`.
- Reprocessar uma resposta tipo "pode ser quarta 15h" depois de slots oferecidos e conferir que aí sim ele chama `calcom-confirm-booking`.
- Checar `sdr_agent_runs.metadata` em busca do log de downgrade.
