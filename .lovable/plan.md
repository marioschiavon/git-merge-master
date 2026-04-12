

## Blindar o fluxo de agendamento contra falhas

### Problemas encontrados no `inbound-webhook/index.ts`

**Bug 1 — slotContext só é construído se `heldSlots.length >= 2` (linha 134)**
Quando os slots expiraram (status "held" mas past `expires_at`), `heldSlots` volta vazio. A IA não recebe NENHUM contexto de que há um agendamento em andamento. Resultado: classifica como `schedule` (oferecendo novos slots aleatórios) ao invés de `check_availability`.

**Bug 2 — Enrollment é pausado incondicionalmente no bloco `schedule` (linhas 500-504)**
Mesmo quando a ação é sobrescrita para `reply` (ex: meeting já agendada, linha 459), o código na linha 500 AINDA pausa o enrollment porque está fora do `if (parsed.action === "schedule")`.

**Bug 3 — `check_availability` depende 100% da IA extrair `suggested_datetime` em ISO 8601**
Se a IA não parseia "dia 15 às 14h" → `suggested_datetime` é null → o bloco check_availability não executa → cai no fallback genérico "Como posso ajudá-lo?".

**Bug 4 — Sem proteção contra slots expirados que ainda estão como "held"**
A query de slots (linha 123-128) filtra `status = "held"` mas NÃO filtra por `expires_at > now()`. Slots expirados aparecem como "held" se o cron falhou, causando estados inconsistentes.

### Correções

**1. Dar contexto de agendamento mesmo sem held slots ativos**
Se o enrollment está `paused` com `paused_reason = 'awaiting_slot_confirmation'`, incluir contexto no prompt informando que há um agendamento em andamento e que o prospect pode estar sugerindo horário alternativo.

```typescript
// Adicionar após linha 130
let schedulingInProgress = false;
if (heldSlots.length === 0 && enrollment) {
  const { data: enrollCheck } = await supabase
    .from("cadence_enrollments")
    .select("paused_reason")
    .eq("id", enrollment.id)
    .maybeSingle();
  if (enrollCheck?.paused_reason === "awaiting_slot_confirmation") {
    schedulingInProgress = true;
  }
}
```

Quando `schedulingInProgress` e sem held slots, adicionar contexto alternativo ao prompt:
```
"ATENÇÃO: Há um processo de agendamento em andamento com este prospect (os horários anteriores expiraram).
Se o prospect mencionar qualquer horário ou dia → action = 'check_availability' com suggested_datetime em ISO 8601."
```

**2. Filtrar slots expirados na query**
```typescript
// Linha 123-128: adicionar filtro de expiração
.gt("expires_at", new Date().toISOString())
```

**3. Mover pausa do enrollment para dentro do bloco condicional**
```typescript
// Linhas 500-505: mover para dentro do if (parsed.action === "schedule") na linha 467
```

**4. Fallback server-side para parsear datetime quando IA não fornece**
Quando `action = "check_availability"` mas `suggested_datetime` é null, extrair data/hora do conteúdo da mensagem via regex:
```typescript
function extractDateTimeFromText(text: string): string | null {
  // Padrões: "dia 15 às 14h", "dia 15 as 17:00", "terça às 10h", "15/04 às 14h"
  // Retorna ISO 8601 ou null
}
```

**5. Quando `schedule` é chamado mas `schedulingInProgress`, redirecionar para `check_availability`**
Se a IA retorna `schedule` mas já estamos em processo de agendamento, o prospect provavelmente está sugerindo um horário — tratar como `check_availability` extraindo a data do conteúdo da mensagem.

### Escopo
- 1 edge function modificada: `inbound-webhook/index.ts`
- ~60 linhas adicionadas/modificadas
- Nenhuma mudança de banco de dados
- Re-deploy automático

### Resultado esperado
- Prospect sugere "dia 15 às 14h" → sistema verifica Cal.com nesse horário → confirma ou oferece alternativas
- Nunca mais "Como posso ajudá-lo?" quando há agendamento em andamento
- Slots expirados não causam estados fantasma

