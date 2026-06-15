## Diagnóstico

Olhei o run mais recente do lead (Carolina, 15/06 20:46). O lead respondeu:
> "Quarta-feira. Pode adicionar no invite o Eduardo? whatsappcarneiro@gmail.com"

O agente gerou uma boa mensagem (acusou o convidado + repetiu os 2 horários), mas ela **nunca chegou** ao lead. Causas encontradas:

**1) `offer_slots` aborta silenciosamente quando os holds expiraram.**
Em `sdr-agent/index.ts` (l.2060-2151), antes de enviar a mensagem o código valida que cada ISO oferecido tem hold ativo. Se nenhum sobrevive (caso atual — os holds anteriores foram liberados pelo book_slot tentado), o caminho cai em:
```
liveResult = { action: "offer_slots", ok: false, error: "no_valid_holds" }
```
e **pula completamente a chamada `execute-action`**. Resultado: `final_output.message` existe, mas nada é enviado pelo canal. Foi exatamente o que aconteceu — `final_output.live = { ok:false, error:"no_valid_holds" }` e não há outbound no `messages` depois das 20:38.

**2) `book_slot` foi tentado mas bloqueado por "falta de confirmação explícita".**
A `rationale` do run diz isso. O lead disse "Quarta-feira" — bate com 1 (e só 1) dos 2 slots oferecidos (qua 09:00 vs sex 09:45). O `matchesSlotReference` já resolve isso (score por dia → único positivo vence), mas o `booking-guards` exige confirmação textual mais forte ("pode ser", "confirmo", "esse mesmo"). Hoje "Quarta-feira" sozinho não passa.

**3) Combinação `add_guests` + escolha de slot vira `add_guests` puro.**
O `intent-classifier` priorizou `add_guests` (lead pediu pra incluir Eduardo). Como não há booking ativo, o post-action `add_guests_to_active_booking` não roda; e como o intent não é `confirm_slot`, o LLM não escolhe book_slot com confiança. Os `guest_emails` ficam pendurados sem ação.

---

## Plano

### 1. Nunca silenciar uma `finalize` — sempre entregar a mensagem
Em `supabase/functions/sdr-agent/index.ts`, no branch `offer_slots` (l.2081):
- Quando `offered.length === 0` (ou `no_valid_holds`), **recriar os holds** chamando `check_calendar` para os ISOs originais antes de desistir. Se a janela ainda está livre no Cal.com, refaz o hold e segue normal.
- Se mesmo assim não conseguir holds (slots realmente indisponíveis), **enviar a mensagem mesmo assim** com um aviso curto ("os horários que mencionei podem ter sido preenchidos, me confirma e eu reservo na hora") — em vez de descartar.
- Garantia geral: adicionar invariante no fim de `runAgent` — se `final_output.message` está populado e `liveResult.sent` ≠ true e nenhum `forced_tool` enviou outbound, chamar `execute-action send_reply` como fallback (com flag de log). Isso evita futuras regressões silenciosas.

### 2. Tratar "só o dia" como seleção implícita quando há apenas 1 slot naquele dia
Em `_shared/booking-guards.ts` (a guarda que pediu confirmação explícita):
- Quando `selected_slot_iso` veio do `entity-extractor` E entre os `offered_slots_pending` **apenas um** cai naquele dia, considerar isso confirmação suficiente para `book_slot` — sem exigir verbo de confirmação adicional.
- Se houver ≥2 slots no mesmo dia (ex.: ofereci qua 9h e qua 14h), manter exigência de hora/confirmação (já é ambíguo).
- Adicionar testes em `booking-guards_test.ts` cobrindo: (a) "quarta-feira" + 1 slot quarta + 1 sexta → confirma; (b) "quarta" + 2 slots quarta → pede hora; (c) "quarta às 9" → confirma (caso atual já funciona).

### 3. `add_guests` + slot na mesma mensagem → bookar com guests
Em `_shared/policy-engine.ts`:
- Quando `intent === "add_guests"` E `entities.selected_slot_iso` está setado E **não** existe booking ativo, sobrescrever para `forced_tool = "book_slot"` com `forced_args = { slot_start: selected_slot_iso, guest_emails }`. O post-action `add_guests_to_active_booking` só faz sentido com booking existente.
- Testes em `policy-engine_test.ts`: lead pede slot + guests sem booking → forced book_slot com guests; lead pede só guests com booking → mantém add_guests_to_active_booking.

### 4. Validação ao vivo
- Rodar `supabase--test_edge_functions` para os tests de `policy-engine`, `booking-guards`, `entity-extractor`.
- Reenviar a mensagem da Carolina via `supabase--curl_edge_functions` (sdr-debounce-tick ou sdr-agent direto com o último inbound) e confirmar que: (a) `book_slot` roda com guests, (b) outbound é persistida em `messages` com `delivery_status`, (c) `bookings` cria o evento com o Eduardo no `raw_payload.guests`.

### Arquivos a editar
- `supabase/functions/sdr-agent/index.ts` — branch offer_slots + fallback de envio
- `supabase/functions/_shared/booking-guards.ts` — regra de "dia único"
- `supabase/functions/_shared/booking-guards_test.ts` — 3 testes
- `supabase/functions/_shared/policy-engine.ts` — combinar add_guests + selected_slot
- `supabase/functions/_shared/policy-engine_test.ts` — 2 testes

### Fora de escopo
- Mudar o `intent-classifier` para um intent composto (`confirm_slot_with_guests`). A fix no policy engine já cobre o caso sem inventar um novo intent.
- Mexer no `cadence-executor` ou em outros fluxos não-SDR.
