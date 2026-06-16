# Por que o agendamento falhou (e não é HITL)

Você tem razão: HITL deveria só aprovar mensagens. Os erros que você está vendo são **dois bugs antigos no fluxo de scheduling** que só apareceram agora porque um lead executou pela primeira vez a sequência completa "agenda → cancela → reagenda" — algo que não foi testado antes.

## Diagnóstico (com evidência do banco)

Estado real do lead `e989eeb3...`:
- `lead_memory`: **0 linhas no banco inteiro** (nunca foi salvo). Logo `offered_slots_pending` está vazio.
- `slot_holds` ativos: 3 — o `2026-06-17 19:15Z` (16:15 BRT, o da reunião **já cancelada**) continua com status `confirmed`, e mais os 2 novos (`15:30 qua`, `16:45 sex`).

Fluxo do erro:
1. Lead pediu "Preciso marcar de novo" → agente ofereceu 2 slots (15:30 qua / 16:45 sex).
2. Persistir `offered_slots_pending` no `lead_memory` **falhou silenciosamente** (try/catch engole) — porque o upsert manda só `{ lead_id, facts }` e a coluna `company_id` é `NOT NULL`.
3. Lead respondeu "Quarta". Guard de booking caiu no fallback: `candidates = heldIsos` (todos os holds com status `held` OU `confirmed`).
4. Esse fallback puxou também o hold antigo `16:15 quarta` (status ainda `confirmed` porque o cancel do Cal.com **não libera o slot_hold**).
5. Agora a lista tem duas "quarta" → "Quarta" vira ambíguo → guard retorna `no_confirmation` → mensagem de re-pergunta lista 3 horários (incluindo o cancelado), assustando o lead.

Nada disso passa por `hitl-gate`, `approval-execute` ou pela camada de aprovação. O HITL está correto.

## Correções

### 1. `sdr-agent`: incluir `company_id` no upsert de `lead_memory`
Arquivo: `supabase/functions/sdr-agent/index.ts` (linha ~2284, branch `offer_slots`).
Trocar `{ lead_id, facts }` por `{ lead_id, company_id: ctx.lead.company_id, facts }`. Varrer o arquivo (`rg "lead_memory"`) e aplicar o mesmo em qualquer outro `upsert`/`update`/`insert` que esteja faltando.

Também: trocar o `try { } catch(_) {}` mudo por `console.error` quando o upsert retornar erro, pra esse tipo de regressão aparecer nos logs em vez de sumir.

### 2. `calcom-booking-cancel`: liberar `slot_holds` associados
Arquivo: `supabase/functions/calcom-booking-cancel/index.ts`.
Depois do cancel confirmado no Cal.com, marcar `slot_holds.status='released'` para a(s) linha(s) cujo `slot_datetime` bate (±5min) com `bookings.scheduled_at` desse `booking_uid` e `lead_id`. Isso elimina o lixo que polui `candidates` no próximo turno.

### 3. `booking-guards`: deixar de aceitar `status='confirmed'` como candidato implícito
Arquivo: `supabase/functions/sdr-agent/index.ts` linha 685 — a query passada para os guards inclui `status in ('held','confirmed')`. Restringir para `['held']`. Holds `confirmed` representam reservas já efetivadas — não devem reabrir a janela de oferta. (Se o caminho `reschedule_booking` precisar do hold confirmado, ele já tem o `bookings` row pra trabalhar.)

### 4. Validação manual após deploy
- Reabrir o card pendente em `/approvals` (id `f0ba77fd…`) — rejeitar a mensagem com a lista de 3 horários (que está errada).
- Mandar um turno simulado: confirmar que `lead_memory` cria a linha com `offered_slots_pending`, e que o próximo "Quarta" do lead resolve para `15:30` sem cair em `no_confirmation`.
- Aprovar `book_slot` e verificar `bookings.status='confirmed'` + `slot_holds` do 15:30 → `confirmed`, dos outros → `released`/`cancelled`.

## Fora de escopo
- Mudanças no fluxo HITL — está correto, não precisa de ajuste.
- Refator da máquina de estado de scheduling — só ajustes pontuais nos 3 bugs acima.

## Arquivos
- `supabase/functions/sdr-agent/index.ts` — upsert de lead_memory com `company_id` + restringir query de holds a `status='held'`
- `supabase/functions/calcom-booking-cancel/index.ts` — liberar `slot_holds` ao cancelar
