

## Corrigir loop infinito de agendamento no inbound-webhook

### Diagnóstico

A conversa com `eu@julianocarneiro.com.br` mostra o prospect dizendo **"dia 15 as 17h" sete vezes consecutivas**, e toda vez o sistema ignora e oferece 2 novos slots. O motivo é um bug de ordem de operações combinado com problemas de conteúdo.

### Bugs identificados

**Bug 1 (PRINCIPAL) -- Linha 161-175 destrói o estado de agendamento**
Quando uma mensagem inbound chega, o código na linha 169-173 **imediatamente** sobrescreve `paused_reason` para `"lead_replied"`, ANTES da lógica de detecção de agendamento na linha 213. Resultado: `schedulingInProgress` é SEMPRE `false` porque quando checamos, `paused_reason` já foi sobrescrito.

```text
Fluxo atual (ERRADO):
  1. Mensagem chega: "dia 15 as 17h"
  2. Linha 169: UPDATE paused_reason = "lead_replied" ← DESTRÓI "awaiting_slot_confirmation"
  3. Linha 198: held slots = [] (expirados)
  4. Linha 213: schedulingInProgress = false (pq paused_reason != "awaiting_slot_confirmation")
  5. AI não tem contexto de slots → retorna action = "schedule"
  6. Novos slots oferecidos → LOOP
```

**Bug 2 -- Conteúdo de email inclui toda a corrente de citações**
As mensagens inbound incluem todo o conteúdo citado do email ("Em sáb., 11 de abr. de 2026, 23:35, Lead Automate ... escreveu: > ..."). Isso polui o histórico e confunde a IA com centenas de caracteres irrelevantes.

**Bug 3 -- Sem proteção contra loop de schedule**
Se o último outbound foi `action: schedule` e o prospect responde, o sistema deveria tratar como resposta aos slots oferecidos (confirm/reject/check_availability), não como um novo schedule.

### Correções no `inbound-webhook/index.ts`

**1. Ler `paused_reason` ANTES de sobrescrever (resolver o Bug 1)**
- Mover a query de enrollment (linhas 204-209) para ANTES da atualização "lead_replied" (linhas 161-175)
- Ou salvar o `paused_reason` original antes de sobrescrever
- Na lógica de pausa (linha 169-173), NÃO sobrescrever se `paused_reason === "awaiting_slot_confirmation"` -- deixar o fluxo de slots decidir

**2. Limpar conteúdo de email citado**
Adicionar função `stripQuotedEmail(content)` que remove tudo após padrões como:
- `"Em ... escreveu:"`
- `"> "`
- `"On ... wrote:"`

**3. Adicionar guard contra loop de schedule**
Antes de classificar com IA, verificar se o último outbound teve `action: schedule`. Se sim, adicionar contexto forçado ao prompt indicando que slots já foram oferecidos.

**4. Guardar contexto dos slots oferecidos no metadata da mensagem outbound**
Quando slots são oferecidos (action=schedule), salvar os datetimes no metadata da mensagem. Quando o próximo inbound chegar, recuperar esses slots do metadata mesmo que os `slot_holds` tenham expirado.

### Escopo
- 1 edge function: `supabase/functions/inbound-webhook/index.ts`
- ~80 linhas adicionadas/modificadas
- Sem mudanças de banco de dados
- Deploy automático

### Resultado esperado
- Prospect diz "dia 15 as 17h" → sistema verifica disponibilidade no Cal.com → confirma ou oferece alternativas
- Nunca mais loop de "Ótimo! Tenho 2 horários disponíveis..."
- Histórico de conversa limpo sem citações de email

