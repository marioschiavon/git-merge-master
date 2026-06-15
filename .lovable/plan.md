## Diagnóstico

Cronologia da conversa do Juliano (15/06):

- 19:47:18 — SDR ofereceu 2 slots: **ter 16/06 17:30** e **qui 18/06 17:45**. Ambos viraram `slot_holds` em 19:47:10.
- 19:47:27 — Lead: "Terça".
- 19:48:12 — SDR estreitou: "podemos confirmar para terça-feira (16/06) às **17:30**?"
- 19:48:28 — Lead: "**Ok**".
- 19:48:52 — `sdr-agent` run: intent=`confirm_slot` (conf=1), **selected=null**, stage=`scheduling_clarify`, allowed=`["finalize"]` → só `send_message`. **Nenhuma chamada a `book_slot`.**
- 19:49:53 — SDR mandou "Confirmado então… vou gerar o convite…", mas **a reunião nunca foi criada na Cal.com** (último `calendar_actions` de book é da reserva anterior, das 18:15, já cancelada).

### Causa raiz

Em `supabase/functions/_shared/policy-engine.ts` o `candidates` é `offered_slots ∪ held_slots` (linha 96). Quando o SDR estreita a oferta no último outbound para **um único slot** ("podemos confirmar para 17:30?"), os `candidates` continuam com os 2 slots originalmente oferecidos. Resultado: `confirm_slot` com `selected_slot_iso=null` e `candidates.length=2` cai no ramo "ambíguo" (linha 151) → `scheduling_clarify`, `allowed_tools=["finalize"]`. O modelo só pode mandar mensagem — não tem `book_slot` na caixa de ferramentas.

A função `implicitOfferFromOutbound` já existe em `booking-guards.ts` e detecta exatamente esse caso (último outbound mencionou explicitamente um único slot entre os candidatos), mas a **policy-engine não a usa**. Por isso o `sdr-agent` mandou a mensagem de "confirmado" sem nunca chamar `book_slot`.

## Mudanças

### `supabase/functions/_shared/policy-engine.ts`

1. Aceitar opcionalmente `context.implicit_single_offer_iso?: string | null` em `PolicyInputs.context`.
2. No início de `decidePolicy`, se `intent === "confirm_slot"` (ou `create_booking`) e `entities.selected_slot_iso` for null e `context.implicit_single_offer_iso` estiver setado e existir entre `candidates`, **promover** esse ISO para `entities.selected_slot_iso` antes de entrar no `switch`. Isso faz o fluxo cair em `scheduling_confirming_now` com `forced_tool=book_slot` (linhas 134–146), igual ao caminho de slot único explícito.
3. Manter o fallback antigo (`candidates.length === 1`) intacto para retrocompatibilidade.

### `supabase/functions/sdr-agent/index.ts`

Onde a policy é chamada (no pipeline que loga `sdr-agent pipeline:`), calcular `implicit_single_offer_iso` usando a helper já existente `implicitOfferFromOutbound(lastOutbound, candidates)` e passar via `context`. Já temos `lastOutbound` e `candidates` disponíveis nesse ponto (são os mesmos dados usados em `assertCanBook`).

### `supabase/functions/_shared/policy-engine_test.ts`

Adicionar um teste novo: intent `confirm_slot`, `selected_slot_iso=null`, 2 candidates, `context.implicit_single_offer_iso` = um dos candidates → espera `stage="scheduling_confirming_now"`, `forced_tool="book_slot"`, `forced_args.slot_start` igual ao implicit.

## Backfill manual

A reunião do Juliano para 16/06 17:30 não existe na Cal.com — só a mensagem de "confirmado" foi enviada. Após o deploy, posso criar manualmente o booking via `calcom-booking-create` para o slot 2026-06-16T20:30:00Z para esse lead, de modo que ele receba o convite por e-mail prometido. Confirma se quer que eu rode esse backfill junto com o fix.

## Validação

- Rodar `policy-engine_test.ts` (deno test) — passa nos casos existentes + novo.
- Deploy `sdr-agent`.
- Próxima conversa que estreitar oferta a 1 slot + "Ok" do lead deve disparar `book_slot` e o `calendar_actions` mostrar um row `action_type=book status=ok`.
