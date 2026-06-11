## Objetivo

Adicionar um novo tipo de cadência — **Cadência Inteligente (agêntica)** — onde o usuário define **objetivo + limites + tom**, e a IA decide a cada execução: **qual canal, o que dizer, qual gancho, se segue, encerra ou escala para humano**. Convive com as cadências estáticas atuais.

## Como funciona (conceito)

```text
[lead enrolled em cadência inteligente]
          ↓
   tick do cron (cadence-executor)
          ↓
   [agente IA decide próxima ação]
   ├── send(canal, mensagem)   ← LLM escolhe canal + gera texto
   ├── wait(quando)            ← respeita janela horária
   ├── handoff_human(motivo)   ← escala
   └── stop(motivo)            ← encerra cadência
          ↓
   registra decisão + rationale em cadence_agent_decisions
          ↑
   sinais que alimentam o agente:
   - histórico de mensagens
   - intents classificados (lead_intents_log)
   - aberturas/respostas (lead_activities)
   - fit score do lead
   - tentativas já feitas, dias decorridos
   - KB da empresa + tom configurado
```

A IA não segue passo fixo. Cada tick ela vê o estado e decide entre as ações possíveis: **follow-up curto, trazer nova informação, mudar gancho, mandar diagnóstico, pedir indicação do responsável, sugerir horário, encerrar, passar para humano.**

## Configuração nova (UI ao criar cadência)

Toggle no dialog "Nova Cadência": **"Cadência Inteligente (IA decide)"**.

Quando ligado, esconde o editor de steps fixo e mostra:

- **Objetivo** (default: "Agendar reunião de 15 min")
- **Máx. tentativas** (number)
- **Prazo máximo em dias** (number)
- **Canais permitidos** (multi: WhatsApp, Email, LinkedIn)
- **Canal principal** (single, entre os permitidos)
- **Tom** (textarea livre — ex: "Consultivo, curto, personalizado, sem pressão")
- **Critérios para continuar** (textarea livre — ex: "fit > 60, sem opt-out, ainda há responsável a encontrar")
- **Critérios para parar** (checkboxes pré-definidos + textarea livre):
  - [x] Respondeu que não tem interesse
  - [x] Pediu para remover (opt-out)
  - [x] Reunião agendada
  - [x] Passou para humano
  - [x] Atingiu máx. tentativas
  - [x] Passou do prazo
  - [ ] Fit score abaixo de X (slider)
- **Janela horária** (default seg-sex 9h-18h, fuso do lead)

A primeira mensagem reusa o gerador atual (`CadenceFirstMessageInline` / `preview-cadence-messages`) — não muda nada nele.

## Mudanças técnicas

### 1. Banco (migration)

- `cadences`: nova coluna `mode text default 'static'` (valores: `static` | `agentic`). Não toca nas existentes.
- Nova tabela `cadence_policies` (1:1 com cadência quando `mode='agentic'`):
  ```
  cadence_id PK FK
  goal text
  max_attempts int
  max_days int
  allowed_channels text[]
  primary_channel text
  tone_instructions text
  continue_criteria text
  stop_criteria_flags jsonb   -- {no_interest:true, opt_out:true, meeting_booked:true, ...}
  stop_criteria_text text
  min_fit_score int           -- nullable
  business_hours jsonb        -- {start,end,days[],tz}
  ```
- Nova tabela `cadence_agent_decisions` (auditoria + memória do agente):
  ```
  id, enrollment_id, decided_at,
  attempt_number int,
  action text,        -- send|wait|stop|handoff_human
  channel text,       -- whatsapp|email|null
  hook text,          -- followup|new_info|new_hook|diagnostic|ask_referral|suggest_slot|...
  scheduled_for timestamptz,
  message_subject text, message_body text,
  rationale text,     -- por que a IA decidiu isso
  stop_reason text,
  model text, tokens_used int
  ```
- GRANTs + RLS por `company_id` (join via cadência).

### 2. Edge function nova: `cadence-agent-decide`

Entrada: `{ enrollment_id }`.

Fluxo:
1. Carrega enrollment + cadência + policy + lead (com fit_score) + últimos N intents + últimas N mensagens + decisões anteriores do agente + KB da empresa.
2. **Stop checks determinísticos primeiro** (mais barato que LLM):
   - tentativas >= max_attempts
   - dias_desde_enroll >= max_days
   - intent recente = `rejection` → `stop(no_interest)`
   - intent recente = `compliance` (opt-out) → `stop(opt_out)`
   - booking confirmado existe → `stop(meeting_booked)`
   - fit_score < min_fit_score → `stop(low_fit)`
3. Se nenhum bate, chama LLM (`google/gemini-3-flash-preview` via Lovable AI) com structured output:
   ```ts
   {
     action: 'send' | 'wait' | 'stop' | 'handoff_human',
     channel?: 'whatsapp' | 'email',
     hook?: 'short_followup'|'new_info'|'change_hook'|'diagnostic'|'ask_referral'|'suggest_slot',
     scheduled_for?: ISO,
     subject?: string,
     message?: string,
     rationale: string,
     stop_reason?: string
   }
   ```
4. System prompt inclui:
   - Papel de SDR, objetivo da policy, tom, canais permitidos + canal principal preferido.
   - KB + highlights + ai_instructions da empresa (reusa de `generate-reply`).
   - **Anti-alucinação** (reusa blocos já existentes de `inbound-webhook`: não inventar features, não prometer lembretes ativos, regras de booking confirmado).
   - Lista das 8 ações possíveis com quando usar cada uma.
   - Histórico resumido + sinais (aberturas, respostas, tentativas já feitas em cada canal).
5. Normaliza `scheduled_for` para a próxima janela permitida via novo helper `_shared/datetime.ts::nextAllowedSlot(now, businessHours, leadTz)`.
6. Persiste decisão em `cadence_agent_decisions`.
7. Se `action='send'`: chama `send-outbound-message` existente com canal+mensagem.
8. Se `action='handoff_human'`: cria `lead_activities` tipo `handoff` + marca enrollment `status='paused' paused_reason='handoff'`.
9. Se `action='stop'`: marca enrollment `status='completed' completed_at=now()`.
10. Atualiza `current_step++`, `next_execution_at = scheduled_for` ou null.

Idempotência: aborta se já houver decisão `decided_at > now() - 30s` no mesmo enrollment.

### 3. `cadence-executor` (existente) — bifurcação mínima

No loop atual, para cada enrollment due:
- se `cadence.mode = 'static'` → fluxo atual, intocado.
- se `mode = 'agentic'` → `invoke('cadence-agent-decide', { enrollment_id })`.

### 4. Reação a inbound (reusa o que existe)

`inbound-webhook` já trata respostas. Adiciona apenas: quando chega mensagem inbound em lead com enrollment agêntico ativo, faz `update cadence_enrollments set next_execution_at = now() + interval '15 seconds'` para o agente reavaliar logo (decidir se responde aproveitando o `generate-reply` atual, sugere horário, escala, etc.).

### 5. UI

- `src/pages/Cadences.tsx` — toggle "Cadência Inteligente" no dialog de criar; quando ligado, mostra `<AgenticPolicyForm>`.
- Novo `src/components/AgenticPolicyForm.tsx` — todos os campos da policy.
- `src/components/CadenceDetail.tsx` — quando `mode='agentic'`, troca aba "Steps" por:
  - **"Política"** (editar policy)
  - **"Decisões da IA"** (timeline por enrollment: ação, canal, hook, rationale, mensagem enviada, status)
- Novo hook `src/hooks/useAgenticCadence.ts` — CRUD policy + listar decisões.
- Badge "IA" no card da cadência na lista.

### 6. Primeira mensagem

Mantém o caminho atual: ao enrollar lead em cadência agêntica, a **primeira tentativa** usa o gerador atual (`preview-cadence-messages` / template inicial) no canal principal da policy. A partir da segunda tentativa, o agente decide tudo. Isso reusa o que já está pronto e dá um ponto de partida consistente.

## Detalhes importantes

- **Modelo**: `google/gemini-3-flash-preview` via Lovable AI Gateway (já configurado, sem custo de chave).
- **Structured output**: `Output.object` do AI SDK (importado em Deno via `npm:ai`) — evita parse manual de JSON.
- **Stop determinístico antes do LLM**: economiza tokens e evita decisões inconsistentes em casos óbvios.
- **Auditoria total**: cada decisão fica em `cadence_agent_decisions` com `rationale` — usuário vê na UI por que a IA fez o que fez.
- **Reuso máximo**: `send-outbound-message`, `inbound-webhook`, `generate-reply`, `classify-intent`, `cadence-executor`, KB loaders — nada disso é tocado além da bifurcação por `mode`.
- **Custo**: cap de 1 chamada LLM por enrollment por tick; max_attempts é hard stop.

## Defaults que já decidi (você pediu pra eu decidir)

- Convive com cadências estáticas (não substitui).
- IA envia direto, sem fila de aprovação humana (igual estática hoje).
- Sem bandit/aprendizado estatístico nesta fase — só LLM + heurísticas + regras determinísticas. Em fase 2 dá pra ranquear canal/horário por taxa de resposta usando `cadence_agent_decisions` + `messages`.
- Primeira mensagem reusa o gerador atual.

## Fora de escopo

- Migrar cadências estáticas existentes para agêntico.
- Bandit / aprendizado por canal/horário.
- Fila de aprovação humana (modo "IA sugere, humano aprova").
- Reescrever `inbound-webhook` / `generate-reply` / `classify-intent`.
- A/B test estática vs agêntica.

## Validação

1. Criar cadência "GroomerGenius - Clínicas Veterinárias", agêntica, objetivo "Agendar reunião 15min", max 5 tentativas, 12 dias, canais whatsapp+email, principal whatsapp, tom "consultivo, curto, sem pressão", min_fit_score 60.
2. Enrollar lead com fit 75 sem resposta → primeira mensagem sai por whatsapp (gerador atual). Tick seguinte: agente decide follow-up ou troca de canal, registra rationale.
3. Lead responde "não tenho interesse" → próximo tick: stop determinístico, `stop_reason='no_interest'`.
4. Lead responde "fala com a Maria do marketing, maria@..." → agente decide `hook='ask_referral'` ou cria atividade; rationale visível na UI.
5. Lead com fit 45 → stop imediato `low_fit` sem chamar LLM.
6. 5 tentativas sem resposta → stop `max_attempts`.
7. Cadência estática antiga continua funcionando idêntica (regressão).
