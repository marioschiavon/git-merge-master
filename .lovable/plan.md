

## Corrigir 3 problemas: timezone na exibição, double-booking, e formatação BRT

### Problema 1: Horários exibidos em UTC ao invés de BRT

O `toBrtIso` corrige a **geração** do datetime (12h BRT → 15:00 UTC). Mas na **exibição** ao prospect, `new Date(iso).toLocaleTimeString("pt-BR")` no Deno (que roda em UTC) mostra `15:00` ao invés de `12:00`. Isso acontece em 3 lugares:

- `inbound-webhook/index.ts` linha 706-711 (confirmação de booking)
- `calcom-slots/index.ts` linhas 211-214 e 309-318 (formatação de slots alternativos)

### Problema 2: Double-booking

O lead `73be7ea6` tem **2 bookings confirmados** no Cal.com (12:00 UTC e 14:00 UTC). Não existe guard contra confirmar múltiplos bookings para o mesmo lead.

### Problema 3: Mensagem de confirmação não converte BRT

A mensagem "Reunião confirmada para 15 de abril às 12:00" foi gerada com o horário UTC (pré-fix). Mesmo com o fix, exibiria "15:00" (UTC) ao invés de "12:00 BRT".

---

### Correções

**1. Helper de formatação BRT** — em ambos edge functions, criar uma função que formata datetime em BRT:

```typescript
function formatDateTimeBrt(isoString: string): string {
  const dt = new Date(isoString);
  // Subtrair 3h para converter UTC → BRT para exibição
  const brt = new Date(dt.getTime() - 3 * 3600000);
  return brt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    + " às " + brt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
```

Aplicar em:
- `inbound-webhook/index.ts` linha 706-711
- `calcom-slots/index.ts` linhas 211-214 e 309-318
- `calcom-confirm-booking/index.ts` linhas de formatação de data

**2. Guard contra double-booking** — em `inbound-webhook/index.ts`, antes dos fluxos de agendamento (~linha 548), verificar se já existe slot confirmado:

```typescript
if (leadData?.id && ["schedule", "check_availability", "confirm_slot"].includes(parsed.action)) {
  const { data: confirmedSlots } = await supabase
    .from("slot_holds")
    .select("id, slot_datetime")
    .eq("lead_id", leadData.id)
    .eq("status", "confirmed")
    .limit(1);

  if (confirmedSlots?.length) {
    const formatted = formatDateTimeBrt(confirmedSlots[0].slot_datetime);
    parsed.action = "reply";
    parsed.reply_message = `Já temos uma reunião confirmada para ${formatted}! Caso precise reagendar, é só me avisar.`;
  }
}
```

### Escopo
- 3 edge functions: `inbound-webhook`, `calcom-slots`, `calcom-confirm-booking`
- ~30 linhas adicionadas/modificadas
- Sem mudanças de banco de dados

### Resultado esperado
- Horários exibidos ao prospect sempre em BRT (12:00 BRT, não 15:00 UTC)
- Slots alternativos formatados corretamente em BRT
- Nunca mais double-booking: se já tem reunião, informa o prospect
- "Dia 15 as 12h" → booking às 12:00 BRT → mensagem diz "12:00" → Cal.com mostra 12:00

