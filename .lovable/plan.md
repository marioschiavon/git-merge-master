

## Adicionar fluxo de reagendamento (reschedule) — via IA

### Abordagem
Você tem razão: a IA já classifica todas as outras ações pelo contexto. Basta adicionar `reschedule` como action possível no prompt e deixar a IA decidir quando usar. Sem lista de palavras-chave no código.

### Mudanças em `supabase/functions/inbound-webhook/index.ts`

1. **Prompt da IA (linha ~399-427)** — adicionar `reschedule` às ações possíveis:
   - `"reschedule": prospect quer remarcar/reagendar uma reunião já confirmada`
   - Regra: se já existe reunião confirmada e o prospect quer mudar → `action = "reschedule"`. Se incluiu novo horário, preencher `suggested_datetime`

2. **JSON de resposta (linha 421)** — incluir `reschedule` na lista de actions válidas

3. **Guard de double-booking (linha 584)** — excluir `reschedule` da lista de actions bloqueadas. Atualmente bloqueia `schedule`, `check_availability`, `confirm_slot`. O `reschedule` precisa passar.

4. **Novo bloco de execução** — após os blocos existentes, tratar `action === "reschedule"`:
   - Buscar slot confirmado do lead
   - Cancelar booking no Cal.com (`DELETE /v2/bookings/{uid}/cancel`)
   - Atualizar `slot_holds` para `cancelled`
   - Resetar `cadence_enrollments` (`meeting_scheduled = false`)
   - Se `suggested_datetime` existe → chamar `calcom-slots` com `check_datetime`
   - Se não → chamar `calcom-slots` normal para oferecer 2 novos horários
   - Montar reply com os novos horários ou confirmação

### Escopo
- 1 edge function: `inbound-webhook/index.ts`
- ~50 linhas
- Sem mudanças de banco

### Resultado
- Prospect: "Preciso remarcar" → IA classifica `reschedule` → cancela booking → oferece novos horários
- Prospect: "Preciso remarcar para dia 21 às 9h" → IA classifica `reschedule` com `suggested_datetime` → cancela → verifica disponibilidade → confirma ou oferece alternativas

