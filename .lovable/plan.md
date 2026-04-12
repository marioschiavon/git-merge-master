

## Corrigir conversa sem sentido — 2 bugs restantes

### Problema 1: Citações de email NÃO estão sendo removidas

As mensagens inbound estão chegando com o texto citado intacto. Exemplo salvo no banco:

```
Interessante. Eu consigo na quinta as 16 horas.

Em dom., 12 de abr. de 2026, 00:43, Lead Automate <
noreply@internetsegura.com.br> escreveu:
```

O `stripQuotedEmail` falha porque o Gmail quebra a linha entre `<` e o email:
```
Em dom., 12 de abr. de 2026, 00:43, Lead Automate <
noreply@internetsegura.com.br> escreveu:
```

A regex atual `/\r?\n\s*Em .+escreveu:\s*$/im` espera "Em...escreveu:" na MESMA linha. Não funciona com quebra de linha.

**Correção**: Usar regex que permite multi-linha, ou trocar abordagem para buscar "Em " seguido de "escreveu:" em qualquer ponto, considerando newlines entre eles.

### Problema 2: IA sugere horários dentro de `reply` ao invés de usar `schedule`

A mensagem mais recente do SDR tem `metadata.action: "reply"` mas o texto diz "Pode ser na terça às 14h ou na quarta às 10h?". Esses horários são inventados pela IA, sem verificar o Cal.com.

Quando o prospect responde "quinta às 16h", o sistema verifica o `lastOutboundWasSchedule` → é `false` (porque `action` era `"reply"`). Então `schedulingInProgress` = `false`. A IA classifica como `reply` novamente e inventa outros horários. Loop.

**Correção dupla**:
1. No system prompt, adicionar regra explícita: "NUNCA sugira horários de reunião no reply_message. Se o prospect demonstra interesse em reunião, use action = 'schedule' para que o sistema busque horários reais no calendário."
2. Adicionar guard pós-IA: se `parsed.action === "reply"` e o `reply_message` contém padrões de horário (e.g., "terça às 14h", "📅"), forçar `action = "schedule"`.

### Correções no `inbound-webhook/index.ts`

**1. Fix stripQuotedEmail — regex multi-linha**

```typescript
function stripQuotedEmail(text: string): string {
  // Handle Gmail multi-line: "Em ...\n... escreveu:"
  const gmailMultiLine = text.search(/\r?\nEm\s.+/im);
  if (gmailMultiLine !== -1) {
    const afterEm = text.substring(gmailMultiLine);
    if (/escreveu:/i.test(afterEm)) {
      return text.substring(0, gmailMultiLine).trim() || text.trim();
    }
  }
  // ... keep existing patterns
}
```

**2. Instrução anti-horários-fantasma no system prompt**

Adicionar no prompt:
```
REGRA CRÍTICA: NUNCA sugira horários específicos (dia/hora) no reply_message.
Se o prospect quer agendar → action = "schedule" (o sistema busca slots reais).
Responda apenas o conteúdo sem mencionar dias ou horários.
```

**3. Guard pós-IA contra reply com horários**

Após o parsing da resposta da IA (linha ~423), adicionar detecção:
```typescript
if (parsed.action === "reply" && parsed.reply_message) {
  const hasTimePattern = /\b(segunda|terça|quarta|quinta|sexta|sábado|domingo)\s+(à|a)s\s+\d{1,2}/i.test(parsed.reply_message)
    || /📅/.test(parsed.reply_message);
  if (hasTimePattern) {
    console.log("Reply contains time suggestions — redirecting to schedule");
    parsed.action = "schedule";
    parsed.reply_message = null; // let the schedule flow generate proper slots
  }
}
```

### Escopo
- 1 edge function: `inbound-webhook/index.ts`
- ~30 linhas modificadas/adicionadas
- Sem mudanças de banco de dados

### Resultado esperado
- Mensagens inbound limpas (sem citações de email)
- IA nunca inventa horários — sempre passa pelo Cal.com
- Prospect diz "quinta às 16h" → `check_availability` → verifica Cal.com → confirma ou oferece alternativas reais

