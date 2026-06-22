## Diagnóstico

O comportamento persistiu porque o `book_slot` agora está sendo forçado corretamente, mas a guarda central de agendamento (`assertCanBook`) ainda exige que a última mensagem inbound seja uma confirmação de horário. Neste caso, a última mensagem é apenas o e-mail do lead, então a guarda retorna `no_confirmation` e o SDR usa a mensagem de fallback oferecendo os mesmos horários novamente.

## Plano de correção

1. Ajustar a guarda de agendamento em `supabase/functions/_shared/booking-guards.ts`
   - Quando existir `lead_memory.facts.email_just_resolved_slot` válido, não exigir nova confirmação textual na última mensagem.
   - Só liberar se o `slot_iso` salvo bater com o `slot_start` solicitado, dentro da tolerância já usada.
   - Manter todas as outras proteções: slot precisa estar entre os holds/ofertas, precisa existir hold ativo ou refresh bem-sucedido, e não pode haver booking ativo conflitante.

2. Reforçar o fallback no `sdr-agent`
   - Se `book_slot` falhar por `no_confirmation` enquanto há `email_just_resolved_slot` para o mesmo horário, tratar como falha de guarda incorreta e tentar novamente com o caminho liberado pela nova regra.
   - Evitar que esse caso volte a mandar “qual destes horários funciona melhor”.

3. Validar com dados reais da conversa
   - Confirmar que o lead está com e-mail salvo.
   - Confirmar que o hold `2026-06-25T20:45:00+00:00` ainda está `held`.
   - Após deploy, o próximo turno com esse estado deve executar `calcom-confirm-booking`, criar o booking e limpar `email_just_resolved_slot` / `offered_slots_pending`.

4. Deploy e verificação
   - Deploy de `sdr-agent`.
   - Ver logs: `forced_tool_call` com `result.ok=true` e chamada em `calcom-confirm-booking`.
   - Ver banco: novo registro em `bookings` e hold marcado como `confirmed`.