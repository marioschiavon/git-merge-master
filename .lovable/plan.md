
## Problema

A reunião confirmada do Nico (Cal.com booking `7grJzsnf…`) foi cancelada pelo nosso próprio backend ~10 min depois da confirmação, sem nenhuma ação do lead.

## Causa raiz (já confirmada nos dados)

- A empresa tem uma regra em `intent_action_rules` (`8e562c4a…`, category=`scheduling`, sub_intent=`NULL`) com `actions = [cancel_booking, create_cal_booking, mark_meeting_attended, reschedule_booking, send_reply, suggest_meeting_times]` e `auto_execute=true`.
- `_shared/route-intent.ts` enfileira **todas** as actions da regra (menos as de reply explícito). Toda mensagem classificada como `scheduling` enfileira um `cancel_booking` com `params={}`.
- `execute-action.cancel_booking`, sem `booking_uid` nos params, pega "o booking ativo mais recente do lead" — cancelando o que acabou de ser confirmado.
- O `intent-cron` roda a fila no próximo tick (até ~10 min depois), então o cancel chega depois do `BOOKING_CREATED`.

## Plano de correção

### 1. Whitelist de sub_intent para ações destrutivas
Em `supabase/functions/_shared/route-intent.ts`:
- Definir um mapa `SUB_INTENT_GATED` para `cancel_booking`, `reschedule_booking`, `mark_meeting_attended`, listando os sub_intents legítimos (ex.: `cancel_request`, `reschedule_request`, `attended_confirmation`).
- No loop de enfileiramento, se a action está em `SUB_INTENT_GATED` e o `sub_intent` atual não está no set, pular com `skipped++` (sem enfileirar). Logar `console.log` com `reason="sub_intent_not_allowed"` pra rastrear.

### 2. Defesa em profundidade no executor
Em `supabase/functions/execute-action/index.ts`, dentro de `cancel_booking`:
- Se `booking_uid` não veio nos params, carregar o `lead_intents_log` via `ctx.intent_log_id` e exigir `sub_intent ∈ {cancel_request, wants_to_cancel, cancel_meeting}`. Caso contrário, lançar erro `cancel_booking: sub_intent não compatível (<valor>) — nenhuma ação tomada` — a fila marca como `failed` e nada é cancelado.
- Aplicar a mesma checagem em `reschedule_booking` e `mark_meeting_attended`.

### 3. Limpar regras omnibus existentes
Migration de dados (via insert tool) que, para todas as empresas:
- Em `intent_action_rules` com `category='scheduling'` e `sub_intent IS NULL`, remove `cancel_booking`, `reschedule_booking` e `mark_meeting_attended` do array `actions`. Mantém `send_reply`, `suggest_meeting_times`, `create_cal_booking`.
- Isso resolve o caso do Nico e qualquer outro tenant que tenha caído na mesma armadilha.

### 4. Limpar fila pendente
- `UPDATE lead_action_queue SET status='cancelled' WHERE status='pending' AND action_type IN ('cancel_booking','reschedule_booking','mark_meeting_attended') AND triggered_by LIKE 'rule:%'` — evita que ações destrutivas já enfileiradas (pra outros leads) disparem no próximo tick do cron.

## Validação

- Inserir manualmente `lead_intents_log` `category=scheduling, sub_intent=selected_time` para um lead de teste e confirmar via `select * from lead_action_queue` que **não** aparece `cancel_booking`.
- Inserir um `sub_intent=cancel_request` e confirmar que `cancel_booking` é enfileirado.
- Conferir que a reunião do Nico **continua cancelada** (não dá pra reverter no Cal.com via API), mas nenhuma nova reunião cai sozinha.

## Fora de escopo

- O bug do canal de WhatsApp respondendo por email é tratado separadamente (Fix A do plano anterior).
- Recriar o booking do Nico no Cal.com — vou apenas anotar uma `lead_activity` informando que foi cancelamento automático indevido, e você ou o Nico reagendam.
