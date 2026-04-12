

## Corrigir: IA fornece datetime sem offset BRT

### Problema raiz

Quando a IA retorna `suggested_datetime: "2026-04-17T10:00:00"`, esse valor vai direto para o Cal.com como UTC. Mas "10:00" era a hora em Brasília — deveria ser `13:00 UTC`.

O `extractDateTimeFromText` aplica o offset BRT corretamente, mas só é usado como **fallback** (linha 521) quando a IA **não** fornece o datetime. Quando a IA fornece, o valor vai cru.

### Correção

No `inbound-webhook/index.ts`, após parsear o JSON da IA (~linha 472), adicionar compensação BRT ao `suggested_datetime` da IA:

```typescript
// Se a IA forneceu suggested_datetime, compensar BRT→UTC
// A IA interpreta horários em Brasília mas formata como se fosse UTC
if (parsed.suggested_datetime && !parsed.suggested_datetime.endsWith("Z")) {
  const naive = new Date(parsed.suggested_datetime);
  if (!isNaN(naive.getTime())) {
    // Adicionar 3h para converter de "BRT naive" para UTC
    const utc = new Date(naive.getTime() + BRT_OFFSET_HOURS * 3600000);
    parsed.suggested_datetime = utc.toISOString();
    console.log("Compensated AI suggested_datetime to UTC:", parsed.suggested_datetime);
  }
}
```

Adicionar isso logo após o parsing do JSON (linha 472), antes de qualquer guard que use `suggested_datetime`.

Também aplicar ao fallback na linha 521 — quando `extractDateTimeFromText` é chamado com `content` (não `cleanContent`), já retorna com offset, mas vale garantir consistência.

### Escopo
- 1 edge function: `inbound-webhook/index.ts`
- ~8 linhas adicionadas
- Sem mudanças de banco de dados

### Resultado esperado
- "17 as 10h" → IA diz `2026-04-17T10:00:00` → compensação → `2026-04-17T13:00:00.000Z` → Cal.com verifica 10h BRT → slot correto

