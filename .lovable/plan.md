

## Tornar a IA focada em agendamento e com consciência de contexto

### Problema raiz

A IA não entende o objetivo principal da conversa. Ela trata cada mensagem isoladamente sem considerar que o objetivo final é **sempre agendar uma reunião**. Quando o prospect diz "Quero agendar dia 15 as 14h", a IA responde com informações genéricas porque classifica como `reply` e nenhum guard detecta a intenção.

### 3 correções no `inbound-webhook/index.ts`

**1. Guard no conteúdo INBOUND (pós-AI, ~linha 454)**

Após os guards existentes, adicionar verificação no conteúdo da mensagem do prospect:

```typescript
if (parsed.action === "reply") {
  const lower = cleanContent.toLowerCase();
  const hasScheduleIntent = /\b(agendar|reunião|reuniao|demo|conversar|call|meeting|bate-?papo)\b/i.test(lower);
  const extractedDt = extractDateTimeFromText(cleanContent);
  
  if (hasScheduleIntent && extractedDt) {
    // "Quero agendar dia 15 as 14h" → verifica disponibilidade
    parsed.action = "check_availability";
    parsed.suggested_datetime = extractedDt;
    parsed.reply_message = null;
  } else if (hasScheduleIntent) {
    // "Quero agendar" sem horário → busca slots
    parsed.action = "schedule";
    parsed.reply_message = null;
  } else if (extractedDt) {
    // Menciona horário sem palavra-chave → check_availability
    parsed.action = "check_availability";
    parsed.suggested_datetime = extractedDt;
    parsed.reply_message = null;
  }
}
```

**2. Reforçar system prompt com objetivo principal**

Adicionar no início do prompt:
```
OBJETIVO PRINCIPAL: Seu objetivo FINAL é sempre agendar uma reunião com o prospect. 
Todas as interações devem caminhar para isso. Se o prospect demonstra QUALQUER interesse, 
direcione para agendamento (action = "schedule"). Se ele sugere um horário, 
use action = "check_availability".
```

**3. Incluir mensagem do prospect destacada no user prompt**

Atualmente o histórico mistura tudo. Adicionar destaque para a última mensagem:
```
ÚLTIMA MENSAGEM DO PROSPECT (analise com atenção):
"${cleanContent}"
```

Isso garante que a IA não perca o conteúdo da mensagem atual em meio ao histórico.

### Escopo
- 1 edge function: `inbound-webhook/index.ts`
- ~25 linhas adicionadas/modificadas
- Sem mudanças de banco de dados

### Resultado esperado
- "Quero agendar dia 15 as 14h" → `check_availability` → Cal.com → confirma ou alternativas
- "Tudo bem? Quero conhecer mais" → AI responde + direciona para reunião
- "Consigo na quinta as 16h" → `check_availability` → verifica Cal.com
- Nunca mais resposta genérica ignorando pedido de agendamento

