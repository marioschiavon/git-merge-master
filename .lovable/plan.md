## Diagnóstico

A mensagem "Oi, Juliano! Vi que você cancelou nossa conversa..." **não foi enviada pelo SDR turn original**. Ela veio do handler `acknowledge_cancellation` em `execute-action/index.ts`, disparado pelo webhook do Cal.com quando a reunião foi cancelada às 19:39 (pelo meu backfill manual de cancelamento, mas o mesmo bug acontece daqui em diante com o safety-net que adicionei).

Esse handler já tem dois guards para suprimir o follow-up:
1. `bookings.cancellation_source != 'lead'` → skip.
2. SDR mandou outbound nos últimos 10 min → skip.

**Por que ambos falharam:**
- O safety-net que adicionei (`sdr-agent/index.ts` linhas ~1814-1844) chama `calcom-booking-cancel` direto via `supabase.functions.invoke`, **sem antes setar** `bookings.cancellation_source = 'sdr'`. Só o handler inline da tool `cancel_booking` (linha ~613) faz esse update. Então o webhook vê `cancellation_source = NULL` e trata como cancelamento do lead.
- A janela de 10 min também passou (booking cancelado 11 min depois do outbound), mas isso é secundário — o cancellation_source é a fonte primária.

## Mudanças

### `supabase/functions/sdr-agent/index.ts`
No bloco safety-net (logo antes de invocar `calcom-booking-cancel`), marcar o booking como cancelado pelo SDR — exatamente como o handler inline da tool faz:

```ts
try {
  await supabase.from("bookings").update({
    cancellation_source: "sdr",
    cancellation_requested_at: new Date().toISOString(),
  }).eq("calcom_booking_uid", activeBookingRow.calcom_booking_uid);
} catch (_) {}
```

Isso garante que quando o webhook do Cal.com chegar e enfileirar `acknowledge_cancellation`, o guard em `execute-action/index.ts` linha 788 (`cancellation_source != 'lead'`) o ignore — sem mensagem duplicada de follow-up.

### Validação
- Deploy de `sdr-agent`.
- Em ambiente real, próxima conversa com mesmo cenário (lead redireciona + SDR promete cancelar) deve produzir: mensagem "Vou cancelar..." enviada ao indicante (comportamento atual desejado) + cancelamento real no Cal.com + **nenhuma** mensagem subsequente "Vi que você cancelou...".

### Não há backfill necessário
O caso do Juliano de hoje já passou e a mensagem indesejada saiu. Daqui em diante o guard suprime.
