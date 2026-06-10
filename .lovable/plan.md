## Problemas observados na conversa do Kiko

1. **Hora errada no prompt e na confirmação** — o slot oferecido foi `quinta 11/06 às 18:45` (BRT). Quando Kiko respondeu "Pode ser dia 11", a IA respondeu "confirmando nosso papo na quinta, 11 de junho, às **21:45**" (UTC) e a ação ficou `reply`, então **nenhum booking foi criado** no Cal.com.

2. **Slots órfãos no Cal.com** — quando Kiko disse "Não quero mais" (action `pause`), os 2 holds anteriores (30/06 e 02/07) **continuaram `held`** no banco e no Cal.com. Quando ele voltou ("Quero retomar") e o fluxo `schedule` rodou de novo, foram criados +2 holds novos sem cancelar os anteriores — sobrando 4 reservas vivas no Cal.com.

3. **Confirmação parcial não fecha o booking** — "Pode ser dia 11" identifica claramente um dos 2 slots oferecidos (só um deles é dia 11), mas a IA voltou `reply` em vez de `confirm_slot`, então a reunião não foi confirmada.

## Causa raiz

**Bug 1 — Timezone faltando.** Em `supabase/functions/inbound-webhook/index.ts`, o `slotContext` (linhas 412–449) usa `dt.toLocaleDateString("pt-BR", …)` e `dt.toLocaleTimeString("pt-BR", …)` **sem `timeZone: "America/Sao_Paulo"`**. O runtime do Deno é UTC, então a IA recebe os horários em UTC e responde em UTC, mesmo quando o outbound original foi formatado em BRT (via `formatBRTLong`).

**Bug 2 — `pause` não cancela holds.** O ramo `parsed.action === "pause"` (linhas 1296–1305) só atualiza o `cadence_enrollments`. Não toca em `slot_holds` nem chama `cancelCalcomReservation`. O ramo `schedule` (linhas 1221–1294) também não cancela holds existentes antes de criar novos.

**Bug 3 — Sem fallback determinístico para confirm_slot.** Quando o prospect identifica um único slot por dia ("dia 11", "segunda", "às 18:45"), nada força `confirm_slot` se a IA decidir mandar `reply`. Hoje só existem fallbacks para `check_availability` / `reject_slots`.

## Correções

### 1. `inbound-webhook/index.ts` — formatação BRT no slotContext
Substituir as 4 chamadas `toLocaleDateString/toLocaleTimeString("pt-BR", …)` dentro de `slotContext` (linhas ~412–449) por uma helper local que sempre passa `timeZone: "America/Sao_Paulo"` — ou reutilizar `formatDateTimeBrt` do `_shared/datetime.ts` já importado no arquivo. Isso garante que a IA veja "18:45" igual ao que o prospect vê.

### 2. `inbound-webhook/index.ts` — cancelar holds em `pause` e `schedule`
- No ramo `parsed.action === "pause"` (linha 1296): antes do `update` do enrollment, buscar `slot_holds` com `status="held"` para esse `lead_id`, chamar `cancelCalcomReservation(cal_booking_uid)` para cada um e marcar `status="cancelled"` no DB. Mesma lógica já usada no ramo `cancel` (linhas 1049–1070), só sem mexer em bookings confirmados.
- No ramo `parsed.action === "schedule"` (linha 1240, antes do `invoke("calcom-slots")`): rodar o mesmo cleanup de holds `held` para evitar acumular reservas quando o lead recomeça o agendamento.

### 3. `inbound-webhook/index.ts` — fallback determinístico para confirm_slot
Logo após o bloco de fallback do `confirm_slot` (linhas 732–751), adicionar:
- Quando `heldSlots.length >= 1`, `schedulingInProgress` é true, e a ação parseada é `reply`, tentar casar `cleanContent` com **um** dos held slots:
  - "dia 11", "11/06", "11 de junho" → procura held slot cujo dia BRT bate.
  - "às 18:45", "18h45", "18:45" → procura held slot cujo horário BRT bate.
  - "segunda", "quinta" etc. → dia da semana BRT.
- Se exatamente **um** held slot bater, setar `parsed.action = "confirm_slot"`, `parsed.selected_slot = índice+1`, `parsed.reply_message = null` e deixar o ramo `confirm_slot` existente (linhas 792+) fazer o booking.
- Se zero ou mais de um baterem, manter `reply` (comportamento atual).

Toda a checagem de data/hora roda em BRT, reutilizando a mesma conversão da correção 1.

## Fora do escopo
- Não vou alterar `classify-intent` nem outros ramos (`reject_slots`, `check_availability`, `reschedule`) — o problema do Kiko se resolve com as 3 mudanças acima.
- Não vou criar tabela nem migration — só edição em um arquivo de edge function.
- Não vou alterar o prompt da IA além do que sair "de graça" ao formatar os horários em BRT.

## Detalhe técnico
Arquivos tocados:
- `supabase/functions/inbound-webhook/index.ts` (apenas)

Helpers já disponíveis:
- `formatDateTimeBrt` (importado de `_shared/datetime.ts`) para a parte 1.
- `cancelCalcomReservation` (já usado no ramo `cancel`) para a parte 2.
