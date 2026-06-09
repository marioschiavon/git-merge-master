# Fix: "Reunião remarcada" aparecendo sem reunião confirmada

## Diagnóstico

Na conversa do Juliano:

- Prospect respondeu `Dia 17 as 20h` (primeira sugestão de horário, nenhuma reunião confirmada antes — só slots em hold).
- O classificador da IA marcou a resposta como `action = "reschedule"`.
- O branch `reschedule` em `inbound-webhook/index.ts` sempre insere a mensagem de sistema `🔄 Reunião remarcada` (via `insertBookingSystemMessage` com `event_type: "booking_rescheduled"`), **mesmo quando nenhum booking confirmado foi de fato cancelado**.

Por isso aparece "Reunião remarcada · 09/06, 16:18" mesmo o lead apenas sugerindo um horário pela primeira vez.

## Correção

### 1. Gatear a inserção do system message (fix principal)

Em `supabase/functions/inbound-webhook/index.ts`, no branch `parsed.action === "reschedule"`:

- Só inserir o `insertBookingSystemMessage({ event_type: "booking_rescheduled", ... })` quando **um booking confirmado foi de fato cancelado** — ou seja, quando `cancelledBookingUid` e/ou `cancelledScheduledAt` estão preenchidos (já são populados ao iterar `liveSlots` com `status === "confirmed"` ou `activeBookings`).
- Caso contrário (apenas held slots cancelados ou nenhum), pular a mensagem de sistema. O fluxo de buscar novos slots e responder ao prospect continua igual.

Também opcional: trocar a `lead_activity` correspondente (`🔄 Prospect rejeitou horários...`) por uma descrição mais neutra quando não havia booking — fora do escopo agora; manter como está.

### 2. Pequeno ajuste no prompt do classificador (defensa em profundidade)

Em `inbound-webhook` (mesma função, na seção que monta o prompt de slots), adicionar nas `INSTRUÇÕES PARA SLOTS PENDENTES`:

> Use `action = "reschedule"` SOMENTE quando o prospect quer mudar uma reunião **já confirmada** anteriormente. Se ainda não há reunião confirmada e o prospect sugere um horário, use `action = "check_availability"` com `suggested_datetime`.

Isso reduz o disparo errado do branch reschedule no futuro.

## Detalhes técnicos

- `cancelledBookingUid` recebe valor apenas quando `slot.status === "confirmed"` (linha ~847) ou quando há `activeBookings` (linhas 862-877). Usar a presença desses como gate é seguro.
- Sem mudança de schema. Sem nova migração.
- Não vou retroativamente apagar a mensagem antiga do Juliano (registro histórico).

## Fora do escopo

- Refatorar a árvore de actions do classificador
- Mudar o texto/ícone do componente que renderiza `booking_rescheduled`
- Limpar conversas antigas

## Resultado esperado

Quando um prospect sugere um horário sem ter uma reunião confirmada antes, a conversa NÃO mostra mais "Reunião remarcada". Apenas a resposta da IA com as novas opções aparece. Reuniões realmente remarcadas (booking confirmado → cancelado → reagendado) continuam exibindo a mensagem corretamente.