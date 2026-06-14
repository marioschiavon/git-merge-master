# Bug: agendamento foi cancelado sozinho e novas opções foram enviadas

## O que aconteceu (lead a6ba77a3, "Dia 16" às 13:30:48)

```text
13:30:30  inbound-webhook RUN #1  ("Dia 15 as 17h")
          → cancela bookings antigos, reserva slots, oferece 2 opções
13:30:32  slot_holds gravados: 15/06 17:45 + 18/06 17:45
          MAS texto da mensagem outbound dizia "16/06 17:30 + 18/06 17:45"
          (mismatch entre texto e slots realmente reservados — bug paralelo)
13:30:48  zapi-webhook recebe "Dia 16"
          → inbound-webhook RUN #2  ("Dia 16", skip_insert=false)
          → matcher determinístico achou hold 16/06 → confirm_slot
13:31:09  calcom-confirm-booking cria booking ayiMejjQ7CgkLwivPyQSrq (16/06 17:30) ✅
13:31:08  inbound-webhook RUN #3  ("Dia 16", skip_insert=true)  ← DUPLICADO
          → matcher determinístico falha (holds atuais são 15+18)
          → AI classifica como "reschedule" com suggested_datetime=15/06 20:00
13:31:10  RUN #3 entra no branch reschedule
13:31:11  cancela booking ayiMejjQ7CgkLwivPyQSrq recém-criado
13:31:12  system msg "🔄 Reunião remarcada"
13:31:13  system msg "❌ Reunião cancelada (era 16/06 17:30)"
13:31:15  outbound "Sem problemas! Aqui vão novas opções: 15/06 17:45, 18/06 17:45"
```

## Causas raiz

1. **inbound-webhook foi invocado duas vezes para a MESMA mensagem `Dia 16`** (mesmo `provider_message_id`). A segunda chamada veio com `skip_insert=true`. Não existe guard de idempotência por `(lead_id, provider_message_id)` dentro de `inbound-webhook`, então a mesma mensagem foi re-processada com o estado de `slot_holds` já alterado pela primeira execução.

2. **`reschedule` cancela bookings recém-confirmados sem janela de proteção.** O branch em `inbound-webhook/index.ts:1421` cancela qualquer booking ativo do lead, independentemente de quão recente seja. Quando duas execuções rodam em paralelo, a segunda destrói o trabalho da primeira.

3. **Mismatch entre slots oferecidos no texto e slots reservados.** A mensagem outbound em 13:30:33 listou `16/06 17:30 + 18/06 17:45` enquanto `slot_holds` da iteração tinha `15/06 17:45 + 18/06 17:45`. Isso confunde o matcher determinístico em runs subsequentes e leva o AI a classificar "Dia 16" como `reschedule` em vez de `confirm_slot`.

## Plano de correção

### A. Idempotência em `inbound-webhook`
Arquivo: `supabase/functions/inbound-webhook/index.ts`

- Logo após resolver `leadData` e o `provider_message_id` do payload, consultar `pending_inbound_runs` / nova tabela leve `processed_inbound_messages(lead_id, provider, provider_message_id, processed_at)` (criar via migration) e retornar `{deduped:true}` quando já existir registro recente (< 5min).
- Gravar o registro ao final da execução bem-sucedida.
- Para mensagens sem `provider_message_id`, usar hash `(lead_id, channel, sha1(cleanContent), bucket_60s)` como chave alternativa.

### B. Guard de "booking acabou de ser confirmado" no branch `reschedule`
Arquivo: `supabase/functions/inbound-webhook/index.ts:1421`

Antes de cancelar bookings em `activeBookings`:
- Carregar `created_at` do booking.
- Se foi criado há menos de 60s pela MESMA conversa (`source IN ('sdr_agent','inbound-webhook')`), abortar o reschedule com log `RESCHEDULE_SKIPPED_RECENT_BOOKING` e simplesmente responder "Sua reunião está confirmada para X — quer trocar?" sem cancelar nada.
- Manter cancelamento normal quando o booking é antigo (caso real de remarcação).

### C. Alinhar texto da oferta com slots realmente reservados
Arquivo: `supabase/functions/inbound-webhook/index.ts` (branches `reject_slots` ~1395, `reschedule` ~1530, `check_availability` ~1700)

Hoje a mensagem usa `slotsRes.data.formatted[0..1]` enquanto `slot_holds` pode ser gravado com horários diferentes (ex.: 17:30 vs 17:45) por causa de retries/segundo lote. Garantir que:
- O texto SEMPRE é renderizado a partir dos `slots[]` que foram efetivamente persistidos (re-formatando `slot_datetime` via `formatDateTimeBrt`).
- Não mostrar um horário que não exista em `slot_holds(status='held')` para o lead no momento.

### D. Reforço no classificador
Arquivo: `supabase/functions/inbound-webhook/index.ts` (prompt em ~651, matcher determinístico em ~1186–1234)

- Quando existir `heldSlots.length >= 1`, o matcher determinístico já deve cobrir frases curtas como "Dia 16", "16", "segunda". Estender para aceitar variações ("o dia 16", "fica o 16", "vai o segundo") via regex adicional.
- Se o AI ainda retornar `reschedule` mas existir um held slot que dá match exato com `suggested_datetime`, converter para `confirm_slot` antes de executar (já existe lógica reversa em 1249; adicionar a inversa).

### E. Verificação
1. Reproduzir cenário: lead recebe 2 opções → responde "Dia X" → executar `inbound-webhook` 2× em paralelo (curl). Esperado:
   - 1ª execução confirma booking.
   - 2ª execução retorna `{deduped:true}` (ou cai no guard de "booking recente") e NÃO cancela.
2. Conferir no banco: exatamente 1 booking ativo, 1 mensagem outbound de confirmação, 0 mensagens "Aqui vão novas opções".
3. Rodar testes unitários existentes (`booking-guards_test.ts`, `state-machine_test.ts`) + adicionar caso novo `inbound-webhook.dedup_test.ts` cobrindo o cenário acima.

## Fora de escopo
- Reduzir intervalo do `sdr-debounce-tick`.
- Investigar por que a segunda invocação ocorreu (provavelmente retry do Z-API ou trigger externo) — a defesa A já neutraliza independentemente da causa.
- Backfill/limpeza de bookings/slot_holds antigos do lead de teste.
