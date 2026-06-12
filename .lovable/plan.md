# SDR Agêntico v2 — Agente Unificado com Tool-Calling

## Decisões confirmadas
- **Modelo**: `google/gemini-2.5-pro` (contexto longo, tool-use forte)
- **Escopo do PR**: Reescrita direta como **agente unificado** (Fase 3), já incluindo memória expandida (Fase 1) e RAG (Fase 2) como parte da mesma entrega — pois o agente precisa delas para funcionar

## Arquitetura nova

```
Mensagem do lead
      ↓
[ sdr-agent ]  ← um único Edge Function com AI SDK
      ↓
  Loop de tools (até resolver):
   ├─ search_knowledge        (RAG na company_knowledge via pgvector)
   ├─ get_lead_memory         (resumo + fatos do lead)
   ├─ update_lead_memory      (persiste novos fatos)
   ├─ check_calendar          (slots disponíveis no Cal.com)
   ├─ book_slot               (agenda no Cal.com)
   ├─ mark_as_referral        (cria contato indicado)
   ├─ schedule_followup       (próxima cadência)
   ├─ escalate_to_human       (passa para humano)
   └─ send_message            (enfileira na fila de aprovação)
      ↓
Resposta entra em `lead_action_queue` (aprovação humana) → envio
```

Substitui o pipeline antigo `classify-intent → cadence-agent-decide → generate-reply`.

## Componentes a construir

### 1. Memória híbrida
**Nova migration:**
- Tabela `lead_memory` (`lead_id`, `summary` text, `facts` jsonb, `updated_at`) — RLS por company_id
- Coluna `conversations.summary` (text) + `summary_updated_at` (timestamptz)

**Nova edge function `summarize-conversation`:**
- Roda a cada 10 novas mensagens (ou via trigger)
- Usa `gemini-2.5-flash-lite` para gerar resumo dos turnos antigos + extrair fatos do lead (objeções, horários preferidos, papel, urgência, interesses)
- Grava em `conversations.summary` e `lead_memory.facts`

### 2. RAG sobre base de conhecimento
**Nova migration:**
- Habilitar extensão `vector`
- Tabela `knowledge_chunks` (`id`, `company_id`, `knowledge_id` fk, `chunk` text, `embedding vector(3072)`, `metadata jsonb`) — RLS por company_id, índice HNSW cosine
- Trigger ou função `enqueue_knowledge_embedding` quando `company_knowledge` é inserida/atualizada

**Nova edge function `embed-knowledge`:**
- Lê documentos de `company_knowledge`, chunka em ~800 chars com overlap de 100
- Embeddings via `google/gemini-embedding-001` (3072d)
- Insere em `knowledge_chunks`
- Endpoint para reindexar uma empresa inteira

**Tool `search_knowledge(query, top_k=5)`** dentro do agente:
- Gera embedding da query, busca top-K por `embedding <=> query` (cosseno)
- Retorna chunks + metadata

### 3. Agente unificado `sdr-agent` (edge function nova)
- AI SDK `streamText` com `tools` e `stopWhen: stepCountIs(50)`
- Provider: `createLovableAiGatewayProvider` apontando para `google/gemini-2.5-pro`
- System prompt inclui: identidade do SDR, perfil da empresa, perfil do lead (`lead_memory`), resumo da conversa, últimas 30 mensagens cruas, política da empresa (cadence_policies)
- Tools listadas acima, cada uma com `inputSchema` Zod e `execute` que faz a operação real (Cal, DB, Z-API, etc.)
- `send_message` **não envia direto** — enfileira em `lead_action_queue` para passar pela aprovação humana já implementada
- Logs de cada step em nova tabela `sdr_agent_runs` (run_id, lead_id, steps jsonb, tokens, latency) para debug

### 4. Reflexão pré-envio (opcional, mas recomendado)
Antes de enfileirar uma resposta, segundo prompt curto com `gemini-2.5-flash-lite` valida:
- Respeita tom da empresa?
- Cita info que existe na KB (não alucinação)?
- Não promete preço/horário inventado?
Se reprovar: regenera 1x; se reprovar de novo, escala para humano com nota.

### 5. Migração e cutover
- **Shadow mode**: por 1 semana, o `sdr-agent` roda em paralelo ao pipeline antigo (chamado pelo `inbound-webhook`), salva resposta em `sdr_agent_runs` mas **não** enfileira. Comparamos qualidade na fila de aprovação.
- **Cutover**: substituir a chamada no `inbound-webhook` e nos crons (`slot-expiry-followup`, `referral-followup-cron`, `cadence-cron`) para usar `sdr-agent`
- Funções antigas (`classify-intent`, `cadence-agent-decide`, `generate-reply`) ficam por 30 dias como fallback, depois removemos

## Ordem de entrega (1 PR por etapa)

| # | Entrega | Risco |
|---|---|---|
| 1 | Migration: `lead_memory`, `conversations.summary`, `knowledge_chunks` + pgvector | Baixo |
| 2 | Edge function `embed-knowledge` + reindexação inicial | Baixo |
| 3 | Edge function `summarize-conversation` + cron a cada hora | Baixo |
| 4 | Edge function `sdr-agent` com todas as tools (shadow mode) | Médio |
| 5 | UI: aba "Runs do Agente" mostrando steps de cada execução (debug) | Baixo |
| 6 | Reflexão pré-envio | Baixo |
| 7 | Cutover do `inbound-webhook` e crons para `sdr-agent` | Médio |
| 8 | Remover funções legadas após 30 dias | Baixo |

## Detalhes técnicos

- **Modelo**: `google/gemini-2.5-pro` para o agente, `gemini-2.5-flash-lite` para sumarização e reflexão
- **Embeddings**: `google/gemini-embedding-001` (3072d), pgvector HNSW
- **AI SDK**: `npm:ai`, `npm:@ai-sdk/openai-compatible`, helper `_shared/ai-gateway.ts` (criar se não existir)
- **Aprovação humana**: `send_message` continua passando por `lead_action_queue` — nada muda no fluxo já aprovado
- **Observabilidade**: `sdr_agent_runs` armazena cada step (tool calls, args, results, tokens) para auditoria

## Riscos e mitigações
- **Custo Pro**: monitorar via `sdr_agent_runs.tokens`. Se ficar alto, fallback para Flash nas decisões simples
- **Latência**: Pro pode ser ~3-5s. OK para nosso fluxo (aprovação humana já tem delay)
- **Regressão**: shadow mode + aprovação humana fecham o loop

## Próximo passo
Aprovar este plano → começo pela etapa 1 (migration de memória + pgvector).
