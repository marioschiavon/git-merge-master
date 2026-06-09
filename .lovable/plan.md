
# Plano: IA estruturada para resposta a leads

Objetivo: substituir o prompt monolítico do `inbound-webhook` por um pipeline determinístico de 5 etapas (intent → state → routing → reply → next action), com intents agrupadas, regras editáveis e histórico completo para análise.

## Etapa 1 — Schema (1 migration)

### `lead_intents_log` (toda classificação fica registrada)
Campos de domínio: `lead_id`, `conversation_id`, `message_id`, `category` (enum 10 valores), `sub_intent` (text, livre), `sentiment` (interesse/objeção/dúvida/rejeição/neutro), `confidence` (numeric 0-1), `entities` (jsonb: data/hora detectada, e-mail referido, nome de pessoa, etc.), `model_used`, `latency_ms`, `raw_response` (jsonb).

### `intent_action_rules` (regras editáveis por empresa)
Campos: `company_id`, `category`, `sub_intent` (nullable = match qualquer), `priority` (int), `actions` (jsonb array de ações com parâmetros), `auto_execute` (bool — se false, sugere e espera humano), `requires_confidence_above` (numeric, default 0.7), `enabled` (bool).

Seed com regras default por categoria.

### `lead_action_queue` (próximas ações agendadas)
Campos: `lead_id`, `action_type` (enum 17 ações), `params` (jsonb), `scheduled_for` (timestamptz), `status` (pending/done/failed/cancelled), `triggered_by` (intent_log_id ou cron name), `executed_at`, `result` (jsonb).

### Enums novos
- `intent_category`: interest, info_request, pricing, scheduling, rejection, routing, channel_switch, compliance, escalation, silence
- `action_type`: as 17 ações + `request_info_from_lead`

RLS: company_admin lê/edita do próprio company_id; service_role total; user lê.

## Etapa 2 — Pipeline de 5 etapas (refator do `inbound-webhook`)

Fluxo por mensagem recebida:

```text
inbound message
   │
   ▼
[1] classify-intent (edge fn nova, modelo barato gemini-flash)
   - retorna: { category, sub_intent, sentiment, confidence, entities }
   - grava em lead_intents_log
   │
   ▼
[2] update-lead-state (puro SQL/TS, sem IA)
   - aplica delta de score por category (tabela score_deltas)
   - atualiza status do lead (interested/qualified/lost/etc.)
   - atualiza last_intent, last_response_at
   │
   ▼
[3] route-decision (puro TS, sem IA)
   - consulta intent_action_rules por (company, category, sub_intent)
   - se confidence < threshold OU category ∈ {compliance, escalation}
     OU rule.auto_execute=false → handoff_to_human
   - senão → seleciona actions
   │
   ▼
[4] generate-reply (edge fn, gpt-5 quando precisa responder)
   - recebe: intent decidida + playbook por segmento + histórico
   - prompt focado em UMA tarefa: escrever a mensagem
   - retorna texto + variáveis
   │
   ▼
[5] enqueue-actions
   - insere em lead_action_queue (send_reply, schedule_followup, create_cal_booking, etc.)
   - actions imediatas executam inline
   - actions agendadas (followup) ficam pro cron
```

## Etapa 3 — Cron jobs (intents implícitas)

Não são intents do prospect, são triggers de tempo:
- `silence_after_interest` — lead com intent=interest há >48h sem resposta nova
- `abandoned_scheduling` — sugestão de horário enviada há >24h sem confirmação
- `no_show_recovery` — reunião marcada que não aconteceu

Cada cron classifica o estado e enfileira action correspondente (followup, recover).

Reusa `pg_cron` + `referral-followup-cron` como modelo.

## Etapa 4 — UI mínima (Configurações > Intents & Ações)

**Não é a configuração de prompts** (essa fica fora deste plano). É só:

- Tabela de `intent_action_rules` da empresa (lista por categoria)
- Editar: ações ligadas, auto_execute on/off, threshold de confiança
- Botão "Restaurar padrões"
- Aba "Logs de classificação" — últimas 100 classificações com category/confidence/mensagem original (debug)
- Aba "Fila de ações" — próximas ações agendadas, com botão cancelar/executar agora

Rota: `/settings/intents`. Acesso: company_admin.

## Etapa 5 — Defaults (seed)

10 categorias × ações padrão razoáveis:
- `interest` → `send_reply` + `update_lead_score(+20)`
- `info_request` → `send_reply` + `send_material(auto-select)`
- `pricing` → `send_reply` + `schedule_followup(2d)` + `update_lead_score(+15)`
- `scheduling` → `suggest_meeting_times` ou `create_cal_booking` (se selected_time detectado)
- `rejection` → `send_reply(polite)` + `stop_sequence` + `disqualify_lead`
- `routing` (referral) → `create_new_contact` + `mark_current_contact_as_referrer` + `send_reply`
- `channel_switch` → `send_email` ou `create_call_task` conforme sub_intent
- `compliance` → `mark_opt_out` + `stop_sequence` + `handoff_to_human`
- `escalation` → `handoff_to_human` (sem auto-reply)
- `silence` → cron decide; default `schedule_followup`

## Fora de escopo (próximos planos)
- UI de edição de prompts (já discutido separadamente)
- A/B testing de classificador
- Treinar modelo próprio com `lead_intents_log`
- Editor visual de regras (drag-drop) — por ora é form simples

## Detalhes técnicos

**Edge functions novas:**
- `classify-intent/index.ts` (gemini-2.5-flash, JSON mode, latência alvo <800ms)
- `generate-reply/index.ts` (gpt-5, recebe intent já decidida)
- `execute-action/index.ts` (worker chamado pelo cron e inline; faz dispatch das 18 ações)
- `intent-cron/index.ts` (silence/abandoned/no-show)

**Edge function refatorada:**
- `inbound-webhook/index.ts` — vira orquestrador: chama classify → update state → route → generate (se precisa) → enqueue. Hoje faz tudo num prompt; passa a fazer chamadas em sequência.

**Hooks novos:**
- `useIntentRules`, `useIntentLog`, `useActionQueue`

**Páginas novas:**
- `src/pages/settings/Intents.tsx` (3 abas: Regras / Logs / Fila)

## Riscos
- Mais latência (2 calls IA em vez de 1). Mitigação: classificador roda em flash, só responde se for responder.
- Custo extra de classificação (~$0.0001 por mensagem) — desprezível.
- Migração: respostas em produção continuam funcionando durante refactor (feature flag no `inbound-webhook` para alternar pipeline novo vs antigo).
- Confiança baixa do classificador pode bloquear respostas — mitigar com fallback "se confidence < 0.4, handoff humano com sugestão".

## Ordem de entrega
1. Migration (schema + seed de regras default)
2. `classify-intent` + log + testes manuais
3. Refator `inbound-webhook` com feature flag
4. `execute-action` worker + `generate-reply`
5. Cron jobs (silence/abandoned/no-show)
6. UI `/settings/intents` (regras + logs + fila)
7. Remover código antigo + flag
