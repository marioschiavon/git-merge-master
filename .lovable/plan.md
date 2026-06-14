
# Pipeline SDR determinístico (intent-first, policy-gated)

Você está certo: hoje o LLM "decide tudo" e a state-machine só corrige depois. A inversão correta é: **código classifica e decide o que é permitido; LLM apenas redige ou executa a tool já liberada**.

## Arquitetura proposta

```text
Mensagem recebida
        │
        ▼
[1] Carrega histórico + estado atual (booking ativo, slots oferecidos, holds, facts)
        │
        ▼
[2] Classificador semântico de intenção        ← LLM pequeno (Gemini Flash), JSON estrito
        │                                          (intent, sub_intent, confidence)
        ▼
[3] Extrator de entidades                       ← LLM pequeno + parsers determinísticos
        │  (datas, horários, slot escolhido,       (chrono-node/regex BRT, match contra
        │   pessoas, preferências, timezone)        slots oferecidos/holds)
        ▼
[4] Policy Engine (PURO, em código)             ← decide stage + allowed_tools + forced_tool
        │  valida intent × estado:
        │   • reschedule + booking ativo → rescheduling
        │   • reschedule + sem booking   → scheduling OU clarify
        │   • create + booking ativo     → bloquear, tratar como reschedule
        │   • cancel + sem booking       → clarify, NÃO chamar Cal.com
        │   • slot escolhido idêntico ao booking → no-op + confirm
        ▼
[5] Atualiza estado (sdr_agent_runs.state, lead_intents_log)
        │
        ▼
[6] Restringe tools expostas ao LLM             ← TOOLS = allowed_tools do Policy Engine
        │                                          (ex.: só `reschedule_booking`+`finalize`)
        ▼
[7] LLM redige resposta OU executa a tool       ← loop curto (≤4 steps), sem poder
                                                   "escolher" outra rota
```

## Mudanças concretas

### A. Novo módulo `_shared/intent-classifier.ts`
- `classifyIntent({ lastInbound, history, state }) → { intent, sub_intent, confidence, raw }`
- Modelo: `google/gemini-2.5-flash`, `response_format: json_object`, prompt curto com taxonomia fechada (`create_booking | reschedule_booking | cancel_booking | confirm_slot | ask_availability | product_qna | objection | referral | not_interested | smalltalk | other`).
- Persistido em `lead_intents_log` (já existe).

### B. Novo módulo `_shared/entity-extractor.ts`
- `extractEntities({ lastInbound, offeredSlots, heldSlots, activeBooking, tz }) → { selected_slot_iso, date_preference, mentioned_people, prefers_period }`
- Combina: regex de datas BR + reaproveita `matchesSlotReference` (já no sdr-agent) + `extractDateRangeFromText` (já existe).
- Resolução determinística primeiro; só chama LLM como fallback de baixa confiança.

### C. Novo módulo `_shared/policy-engine.ts` (substitui parte do `state-machine.ts`)
- `decide({ intent, entities, state }) → { stage, allowed_tools, forced_tool?, response_directive, reason }`
- Tabela de decisão explícita (matriz intent × estado). Saída inclui:
  - `allowed_tools`: subconjunto fechado das tools.
  - `forced_tool`: quando o caminho é único (ex.: `reschedule_booking` com slot já resolvido) — o loop chama direto, sem passar pelo LLM.
  - `response_directive`: instrução curta para o LLM quando há ambiguidade (ex.: "peça ao lead para escolher entre os 2 slots ativos").
- 100% testável via Deno tests (sem rede).

### D. `sdr-agent/index.ts` reescrito como orquestrador fino
Loop novo (≤4 iterações):
1. carrega contexto → `classifyIntent` → `extractEntities` → `policy.decide`
2. se `forced_tool` → executa direto, persiste, finaliza
3. senão → `chatCompletion` com `tools = allowed_tools` e prompt contendo só `response_directive` + estado
4. executa tool retornada (validada novamente contra `allowed_tools`); repete até `finalize`
- Remove os hacks de "pré-resolução", `RESCHEDULE_TEXT_REGEX` no state-machine, `toolFailureCount`, downgrade por `suggested_message`. Tudo isso passa a ser decidido em (C).

### E. `booking-guards.ts`
- `assertCanBook` continua, mas erros viram códigos estruturados (`ACTIVE_BOOKING_EXISTS`, `SLOT_IN_PAST`, `SLOT_NOT_HELD`) consumidos pelo Policy Engine — não pelo LLM.

### F. Testes (Deno)
- `policy-engine_test.ts`: matriz completa (intent × {sem booking, booking ativo, slot selecionado, slot no passado, etc.}).
- `intent-classifier_test.ts`: golden set de ~30 mensagens reais (incluindo "Dia 18", "não consigo nesse horário", "outros horários dia 15").
- `sdr-agent_test.ts`: cenários ponta-a-ponta com stubs do Cal.com — incluindo o bug que originou tudo (lead escolhe "Dia 18" entre 2 opções; agente confirma sem perguntar hora).

### G. Telemetria
- `sdr_agent_runs.state` passa a guardar `{ intent, entities, policy_decision, allowed_tools, forced_tool, steps[] }` para auditoria.

## O que NÃO muda
- Schema do banco (nenhuma migration de tabelas).
- Tools individuais (`check_calendar`, `book_slot`, `reschedule_booking`, `cancel_booking`, `search_knowledge`, `update_lead_facts`, `finalize`) mantêm assinatura.
- Cutover continua total (sem flags), mantendo decisão anterior.

## Risco e mitigação
- **Risco principal:** classificador errar e travar uma intenção legítima. **Mitigação:** quando `confidence < 0.6`, Policy Engine cai para `clarify` (pergunta curta ao lead) em vez de agir. Logamos cada divergência classifier ↔ ação final em `sdr_agent_runs.state` para tunar o prompt.
- **Tempo extra:** +1 chamada Flash (~300ms). Aceitável: elimina loops de 8 steps do Pro.

## Critérios de aceite
1. Cenário "Dia 18 + 2 opções (17:45 e 18:30)" → Policy retorna `clarify` (pedir hora) **se** ambíguo, ou confirma direto se só houver 1 opção naquele dia. **Nunca** sugere data nova.
2. Lead com booking confirmado responde "outro horário dia 15" → intent=`reschedule_booking`, stage=`reschedule_request`, `forced_tool=check_calendar` com `start_after=15/06 00:00 / end_before=15/06 23:59`. Zero chamada a `book_slot`.
3. Lead sem booking diz "cancela" → Policy retorna `clarify`, Cal.com não é chamado.
4. Slot oferecido já no passado nunca chega ao LLM (filtrado no extractor).
5. `sdr_agent_runs.status='running'` por >60s = 0 em condições normais (loop curto + forced_tool).

## Entrega sugerida
PR único, dividido em commits:
1. `policy-engine` + tests (sem integrar)
2. `intent-classifier` + `entity-extractor` + tests
3. `sdr-agent` reescrito + remoção dos hacks
4. Deploy + smoke test no lead `a6ba77a3...`

Confirma esse desenho para eu implementar?
