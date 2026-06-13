## Diagnóstico

O lead escolheu "Segunda" referente ao horário oferecido **segunda-feira, 15/06 às 17:45 (BRT)**. O agente SDR decidiu corretamente `book_slot` com `slot_start = "2026-06-15T17:45:00"`, mas o agendamento **falhou** com erro `"no matching held slot for 2026-06-15T17:45:00"`, caindo no fallback que envia a mensagem "Deixa eu confirmar esse horário aqui pra você e já te retorno em instantes."

### Causa raiz

Em `supabase/functions/sdr-agent/index.ts` (linha ~887), o matching do hold é feito assim:

```ts
const target = new Date(slotStart).getTime();
// compara com hold.slot_datetime tolerando 60s
```

- O agente devolve a hora **em BRT, sem timezone** (ex.: `"2026-06-15T17:45:00"`), porque a mensagem ao lead exibe BRT.
- `new Date("2026-06-15T17:45:00")` em runtime Deno (UTC) interpreta como **17:45 UTC = 14:45 BRT**.
- O hold salvo no banco é `2026-06-15T20:45:00+00:00` (=17:45 BRT).
- Diferença de 3h → nenhum match → fallback é disparado.

Confirmado no `sdr_agent_runs.final_output`:
```
{"live":{"ok":false,"error":"no matching held slot for 2026-06-15T17:45:00","action":"book_slot"}, ...}
```

A reserva no Cal.com **não foi feita** e o lead recebeu uma mensagem confusa pedindo para esperar, quando na verdade o horário estava disponível.

## Correção

Normalizar `slot_start` no handler `book_slot` (e também em `reschedule_booking`, que usa o mesmo padrão de datetime sem TZ vindo do agente) para tratar datetime **sem offset como horário BRT (America/Sao_Paulo, UTC-3)** antes de calcular `target`.

### Mudanças

**Arquivo: `supabase/functions/sdr-agent/index.ts`**

1. Criar helper local `parseSlotStartAsBrt(s: string): number` que:
   - Se a string contém `Z` ou `+HH:MM`/`-HH:MM` no fim → usa `Date.parse` direto.
   - Caso contrário → assume BRT (UTC-3) e soma 3h em ms ao parse UTC ingênuo.

2. Em `book_slot` (linha ~887): substituir `new Date(slotStart).getTime()` por `parseSlotStartAsBrt(slotStart)`.

3. Em `reschedule_booking` (mesmo arquivo): aplicar o mesmo helper onde o `slot_start` do agente é convertido para passar à API Cal.com, garantindo que o ISO enviado leve `-03:00`.

4. (Defensivo) Aumentar a tolerância de match de 60s para 5min, alinhando com o comportamento de `check_availability` em `inbound-webhook` (que já tolera 5min).

### Fora de escopo

- Não vamos mudar o formato que o LLM devolve — manter prompt como está, a correção fica no consumidor.
- Não mexer em `inbound-webhook`, `calcom-confirm-booking`, `calcom-slots`, nem na tabela `slot_holds`.
- Não mexer no fluxo de cancelamento via link do Cal (assunto das mensagens anteriores).

## Verificação

1. Repetir o cenário: oferecer 2 slots, lead responde escolhendo um deles → confirmar que `sdr_agent_runs.final_output.live.action = "book_slot"` com `ok: true` e `booking` preenchido.
2. Conferir mensagem enviada: "Combinado, …, Agendei para …" em vez do fallback.
3. Verificar tabela `bookings` recebeu novo registro `confirmed`.
