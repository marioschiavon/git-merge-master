## Problema

Quando o operador liga o modo Humano, `human-takeover-toggle` pausa o `cadence_enrollments` com `paused_reason='human_takeover'`. Ao desligar (devolver para a IA), a função **não** despausa o enrollment — ela só limpa o flag `human_takeover` na conversa e enfileira um `pending_inbound_runs`.

Consequências:
- Sem nova mensagem inbound do lead, o `sdr-agent` invocado pelo debounce não tem gatilho para gerar reply.
- O `cadence-executor` também não avança porque o enrollment continua `status='paused'`.
- Resultado: nada aparece nas aprovações nem sai mensagem nova.

## Correção

### 1. `supabase/functions/human-takeover-toggle/index.ts` — branch `enable=false`

Ao devolver para a IA, se o enrollment vinculado estiver pausado com `paused_reason='human_takeover'`, despausá-lo:

- `UPDATE cadence_enrollments SET status='active', paused_reason=NULL, next_execution_at=now() WHERE id = conv.cadence_enrollment_id AND paused_reason='human_takeover'`
- Manter o `upsert` em `pending_inbound_runs` só quando `resume_agent=true` (já existe).
- Registrar em `lead_activities` que a cadência foi retomada.

Isso garante que:
- Se havia inbound pendente do lead, o `sdr-agent` roda pelo debounce e gera reply (com aprovação se HITL ligado).
- Se não havia inbound novo, o `cadence-executor` pega o enrollment ativo e agenda/gera o próximo passo normalmente.

### 2. Validação

- Via Playwright: enviar msg como humano numa conversa de teste, devolver para a IA, aguardar ~15s, conferir que aparece nova mensagem/aprovação.
- Conferir em `cadence_enrollments` que `status` voltou para `active` e `paused_reason` está nulo.

## Fora de escopo

- Alterações de UI em Conversas.
- Mudanças na lógica do agente ou do executor.
