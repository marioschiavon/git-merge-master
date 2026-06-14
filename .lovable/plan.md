Causa raiz do refinamento
- Em `sdr-agent/index.ts` linha 1196, o `activeBookingRow` filtra apenas `status='confirmed' | 'pending'`, deixando de fora `'rescheduled'`.
- O booking do lead estava como `rescheduled` (estado atual após remarcação Cal.com), então o pipeline rodou com `has_active_booking=false`.
- Com isso, o intent `create_booking` + slot escolhido caiu em `create_with_explicit_slot` → forçou `book_slot` → Cal.com recusou com `active_booking_conflict` → o agente teve que improvisar o pedido de remarcação.

Refinamento proposto

1. Tratar `rescheduled` como booking ativo
   - Incluir `'rescheduled'` no filtro de `activeBookingRow`. Um booking remarcado continua marcado na agenda; só `'cancelled' | 'no_show' | 'completed'` deixam de ser ativos.
   - Passar `active_booking_at` correto para classifier, extractor e policy.

2. Auto-downgrade quando `book_slot` retornar conflito
   - No loop de execução de tools, se a chamada forçada de `book_slot` falhar com erro do tipo `active_booking_conflict` (ou status 409 indicando booking existente), recomputar a política tratando como `reschedule_booking` com o mesmo `slot_start` e reexecutar.
   - Espelha a recuperação já existente para `booking_not_found → book_slot`, garantindo que o agente nunca fica preso por divergência entre `bookings` local e Cal.com.

3. Desempate no `entity-extractor` quando há slots oferecidos
   - Quando o lead aponta uma data que casa tanto com um `offered_slot` quanto com `activeBookingAt`, priorizar o `offered_slot`. Isso reflete a intenção: "Dia 22" depois de oferecer 22/06 17:45 = escolheu a oferta nova, não o horário antigo.
   - Manter o caminho atual (booking ativo igual ao escolhido → no-op) quando NÃO há ofertas pendentes.

4. Diretriz mais clara no `policy-engine`
   - No branch já existente "selected_slot + booking ativo diferente → reschedule_booking", reforçar a `response_directive` para mencionar o booking anterior e o novo horário, evitando que o LLM duplique perguntas como "quer remarcar?".

5. Testes em `policy-engine_test.ts`
   - Caso A: `intent=confirm_slot`, `selected=22/06 17:45`, `has_active_booking=true (22/06 17:00)` → `forced_tool=reschedule_booking`.
   - Caso B: `intent=create_booking`, `selected=22/06 17:45`, `has_active_booking=true (22/06 17:00)` → mesmo resultado (reschedule, não book).
   - Caso C: extractor com `offered=[22/06 17:45]` + `activeBookingAt=22/06 17:00` e texto "dia 22" → `selected_slot_iso=22/06 17:45` (prioriza oferta).

6. Validação manual
   - Reexecutar o SDR para o lead `a6ba77a3-...` simulando a próxima resposta.
   - Esperado: sem novo `book_slot` para esse turno; se houver intent de remarcar, `reschedule_booking` é forçado com o slot certo; mensagem ao lead reflete a remarcação sem perguntar de novo.

Sem alterações de schema do banco. Mudanças concentradas em:
- `supabase/functions/sdr-agent/index.ts` (filtro de bookings ativos + recuperação `book_slot → reschedule`)
- `supabase/functions/_shared/entity-extractor.ts` (desempate offered vs active)
- `supabase/functions/_shared/policy-engine.ts` (diretriz mais clara, sem mudança estrutural)
- `supabase/functions/_shared/policy-engine_test.ts` (cobertura nova)