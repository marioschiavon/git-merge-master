## Problema

No turno em que o lead envia o e-mail solicitado, o `book_slot` nunca é chamado e a reunião não vai pro Cal.com — apesar do SDR responder "Reunião confirmada".

### Causa raiz (vista nos logs do run `6904ace1…`)

1. Turno anterior: `book_slot` foi forçado → downgrade `request_email` → policy gravou `pending_email_for_slot = { slot_iso: 2026-06-24T12:00:00Z, hold_id }`. SDR pediu o e-mail. ✓
2. Turno atual: lead respondeu `eu@julianocarneiro.com.br`. O `classify-intent` rotulou isso como `smalltalk` (conf 0.80) porque é só uma string de e-mail.
3. Como o intent é `smalltalk`, a `decidePolicy` devolveu:
   - `stage: general`
   - `allowed_tools: [search_knowledge, update_lead_facts, finalize]` — **sem `book_slot`**
   - `forced_tool: null`
4. O bloco de captura de e-mail (linha 1804–1860) capturou o endereço, setou `ctx.pending_email_resolved` e injetou o "AÇÃO OBRIGATÓRIA: chame book_slot", mas o `book_slot` **não está em allowed_tools**, então o LLM seguiu pelo caminho `update_lead_facts` + `finalize(send_message)` e mandou "Reunião confirmada" sem reservar nada. O próprio `rationale` do LLM admite: *"A booking tool falhou, mas a instrução explícita do sistema é para seguir com a mensagem de confirmação"*.

A causa não é o prompt — é a **policy** que está ignorando o `pending_email_resolved`.

## Correção

Editar `supabase/functions/sdr-agent/index.ts`, logo após o bloco de decisão da policy (≈ linha 1890), com um **override** quando `ctx.pending_email_resolved?.slot_iso` está setado:

```text
if (ctx.pending_email_resolved?.slot_iso) {
  policy.stage          = "scheduling_confirming_now";
  policy.allowed_tools  = ["book_slot", "finalize"];
  policy.forced_tool    = "book_slot";
  policy.forced_args    = { slot_start: ctx.pending_email_resolved.slot_iso };
  policy.reason         = "email_just_resolved_for_pending_slot";
}
```

Isso garante que, no mesmo turno em que o e-mail chega (ou no turno seguinte, via hidratação de `email_just_resolved_slot`), o agente seja **forçado** a executar `book_slot` com o slot que já estava combinado — sem depender do LLM nem do classificador de intent.

Comportamento esperado depois do fix:
- Lead manda o e-mail → `book_slot` é executado de fato → `calcom-confirm-booking` cria o booking no Cal.com → cleanup limpa `email_just_resolved_slot`/`pending_email_for_slot`/`offered_slots_pending` → finalize manda a confirmação real.
- Se o `book_slot` falhar por outro motivo (slot indisponível, etc.), o downgrade existente já cobre (ex.: `offer_two_slots`).

## Validação

1. `supabase--edge_function_logs sdr-agent` após próxima conversa: linha `pipeline:` deve mostrar `forced: book_slot` no turno em que o e-mail chega.
2. `supabase--edge_function_logs calcom-booking-create` deve registrar a chamada.
3. `SELECT * FROM bookings WHERE lead_id = … ORDER BY created_at DESC LIMIT 1` deve trazer o registro confirmado.

Sem mudanças em UI, schema ou outras edge functions.
