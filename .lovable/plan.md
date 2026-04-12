

## Corrigir timezone: datas sendo interpretadas em UTC ao invés de Brasília

### Problema

`extractDateTimeFromText` cria datas usando `new Date(year, month, day, hour, minute)` que usa o timezone do servidor (UTC no Deno). Quando o prospect diz "dia 15 as 12h" (Brasília), o sistema gera `2026-04-15T12:00:00.000Z` (UTC) — que corresponde a **9:00 da manhã em Brasília**.

É por isso que os bookings no Cal.com apareceram às 9:00 e 11:00 ao invés de 12:00 BRT.

### Correção

Ajustar `extractDateTimeFromText` para produzir datetimes em **UTC-3 (America/Sao_Paulo)**, adicionando 3 horas ao ISO resultante. Ou seja, quando o prospect diz "12h", o sistema gera `15:00 UTC` que é `12:00 BRT`.

**No `inbound-webhook/index.ts`, função `extractDateTimeFromText`:**

Em todos os pontos onde `new Date(...)` é criado e retornado como `.toISOString()`, subtrair o offset de Brasília (adicionar 3h ao UTC):

```typescript
// Compensar timezone: prospect fala em horário de Brasília (UTC-3)
// "12h BRT" = "15h UTC"
const BRT_OFFSET_HOURS = 3;

function toBrtIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const dt = new Date(Date.UTC(year, month, day, hour + BRT_OFFSET_HOURS, minute));
  return dt.toISOString();
}
```

Substituir todos os `new Date(year, month, day, hour, minute).toISOString()` por `toBrtIso(year, month, day, hour, minute)`.

Também corrigir o pattern de weekday que usa `setHours` — trocar para `Date.UTC` com offset.

### Escopo
- 1 edge function: `inbound-webhook/index.ts`
- ~15 linhas modificadas na função `extractDateTimeFromText`
- Sem mudanças de banco de dados

### Resultado esperado
- "dia 15 as 12h" → `2026-04-15T15:00:00.000Z` (= 12:00 BRT) → Cal.com agenda às 12:00 horário de Brasília
- Todos os horários mencionados pelo prospect em BRT são corretamente convertidos para UTC

