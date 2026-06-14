# Modernizar o SDR — cutover total, AI SDK e remoção do pipeline legado

Aprovado: (1) cutover imediato, (2) sem flag de fallback, (3) migração para AI SDK na mesma PR.

## Resumo do que muda

O `sdr-agent` passa a ser o **único** decisor de cada turno inbound. O pipeline legado (`classify-intent` + branches `schedule/reschedule/reply` no `inbound-webhook`) é removido. O agent é reescrito com o AI SDK (Vercel) + provider Lovable AI Gateway, com tools tipadas em Zod, máquina de estado explícita e resolver determinístico de slots antes da LLM.

## 1. Cutover (banco)

- `UPDATE leads SET pipeline_mode='agent'` em todos os leads.
- `ALTER TABLE leads ALTER COLUMN pipeline_mode SET DEFAULT 'agent'`.
- Manter a coluna para auditoria; remoção fica para PR de housekeeping.

## 2. `inbound-webhook/index.ts` — enxugar

Mantém apenas:
- Validação + CORS + auth do webhook.
- Dedup (`processed_inbound_messages`) — já existe.
- Resolver `lead` + `conversation`, persistir a mensagem inbound.
- Invocar `sdr-agent` (sempre, sem checar pipeline_mode).
- Retornar 200.

Remove:
- Chamada a `classify-intent` para gerar resposta.
- Branches `schedule`, `reschedule`, `reply`, regex `reschedRe`, guard de booking recente (passa a ser responsabilidade do agent via tools).
- `slot_expiry_followups` triggers que dependem do legado (avaliar — provavelmente fica, é cron).

Resultado esperado: ~70% menos código.

## 3. `sdr-agent/index.ts` — reescrever com AI SDK

### 3a. Provider compartilhado

Criar `supabase/functions/_shared/ai-gateway.ts` com o helper canônico `createLovableAiGatewayProvider` (header `Lovable-API-Key`, `X-Lovable-AIG-SDK: vercel-ai-sdk`). Imports via `npm:ai` e `npm:@ai-sdk/openai-compatible`.

### 3b. Loop principal

```ts
const result = await generateText({
  model: gateway("google/gemini-3-flash-preview"),
  system: buildSystemPrompt(ctx),
  messages: convertHistoryToModelMessages(history),
  tools,
  stopWhen: stepCountIs(50),
  experimental_output: Output.object({ schema: TurnDecisionSchema }),
});
```

`TurnDecisionSchema` (Zod): `{ decision: "send_message"|"silence"|"escalate", message?: string, rationale: string }`.

### 3c. Tools (todas com Zod `inputSchema` + `execute` server-side)

| Tool | Função | needsApproval |
|---|---|---|
| `get_calendar_availability` | Busca slots livres no Cal.com em janela | não |
| `offer_slots` | Persiste 2 slots em `slot_holds` e retorna texto formatado | não |
| `book_slot` | Cria booking no Cal.com (idempotente via `assertCanBook`) | sim* |
| `reschedule_booking` | Cancela + reagenda (atomicamente) | sim* |
| `cancel_booking` | Cancela | sim* |
| `update_lead_facts` | Persiste fatos em `lead_memory` | não |
| `finalize_turn` | Encerra com decisão final | não |

*`needsApproval` aqui significa guard determinístico pré-execução (não UI humana): valida estado, idempotência e janela temporal antes de tocar Cal.com.

### 3d. Resolver determinístico de slot (pré-LLM)

Novo `_shared/slot-resolver.ts`:
- Carrega `slot_holds WHERE status='held' AND expires_at>now()`.
- Heurísticas:
  - "dia 18", "no 18", "18/06" → match por data; se houver 1 slot naquele dia → resolve direto.
  - "o que sugeriu", "qualquer um", "tanto faz", "o primeiro", "primeira opção" → primeiro slot ofertado.
  - "o segundo", "a outra" → segundo slot.
  - "as 17", "17h", "17:45" → match por hora dentro do dia já resolvido.
- Se resolve sem ambiguidade, o agent já entra no turno com `prefilled_choice` no contexto e a tool `book_slot`/`reschedule_booking` vira a próxima ação natural.

Isso evita o caso "Dia 18" → "Qual horário?" quando só havia um 18 ofertado.

### 3e. Máquina de estado

`_shared/state-machine.ts` formalizada:
```
idle → offering → awaiting_choice → confirming → confirmed
                ↘ awaiting_clarification        ↘ rescheduling → confirming
                                                ↘ cancelling → cancelled
```
Estado vive em `lead_memory.facts.scheduling_state`. Transições validadas em código — LLM não consegue pular de `confirmed` direto para `offering` sem passar por `rescheduling`.

### 3f. Contexto passado ao LLM

- Últimas 20 mensagens (parts).
- Estado atual + `offered_slots` ativos.
- Booking atual (se houver) com data formatada em BRT.
- Fatos do lead.
- Hora atual em BRT (resolve "horários no passado").
- Pre-resolução de slot (se houver).

### 3g. Filtro temporal

Antes de oferecer slots, filtra fora qualquer slot com `start <= now() + 30min`. Resolve o relato "SDR perguntou horário que já tinha passado".

## 4. Frontend

Sem mudanças. O `inbound-webhook` continua sendo o webhook; `messages` continua sendo a fonte da UI.

## 5. Evals (mesmo PR, mínimo)

`supabase/functions/sdr-agent/sdr-agent_test.ts` com cenários golden (mockando Cal.com + Lovable AI via `Deno.test` + fixtures):
1. "Dia 18" com `[16/10:00, 18/17:45]` → confirma 18/17:45.
2. "O que sugeriu" → confirma 1º ofertado.
3. "Dia 15 segunda" pós-confirmação → reagenda corretamente, **uma** mensagem de confirmação.
4. "Cancela" sem novo horário → cancela e oferece reagendamento, não inventa horário.
5. Lead pede slot fora dos ofertados → checa disponibilidade real antes de confirmar.

## 6. Validação manual pós-deploy

Conversa nova com o mesmo fluxo problemático. Critérios:
- 1 única mensagem `📅 Reunião confirmada` por agendamento.
- "Dia 18" com slot único naquele dia → confirma direto.
- "O que sugeriu" → escolhe primeiro ofertado, nunca inventa.
- Nenhum slot oferecido com horário no passado.

## Arquivos

**Novos:**
- `supabase/functions/_shared/ai-gateway.ts`
- `supabase/functions/_shared/slot-resolver.ts`
- `supabase/functions/sdr-agent/sdr-agent_test.ts`

**Reescritos:**
- `supabase/functions/sdr-agent/index.ts` (AI SDK + tools Zod + state machine + resolver)
- `supabase/functions/inbound-webhook/index.ts` (enxugado, sempre agent)
- `supabase/functions/_shared/state-machine.ts` (formalizar transições)

**Migration:**
- `pipeline_mode` default `'agent'` + backfill.

**Sem mudança:** `calcom-*`, frontend, schema (exceto default acima).

## Riscos e mitigações

- **Risco:** AI SDK em Deno Edge pode ter incompatibilidade pontual. **Mitigação:** uso via `npm:ai@^4` e `npm:@ai-sdk/openai-compatible`, padrão documentado para Edge Functions; testes locais com `deno test` antes de deploy.
- **Risco:** remover legado expõe bugs latentes do agent. **Mitigação:** evals + monitorar `sdr_agent_runs.status='failed'` nas primeiras horas; rollback = reverter PR.
- **Risco:** leads com booking em andamento no momento do deploy. **Mitigação:** cutover idempotente — agent reidrata estado de `bookings`+`slot_holds`.
