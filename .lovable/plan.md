
# Fallback de IA (Lovable → OpenAI → Gemini)

Objetivo: quando o gateway Lovable devolver 402 (créditos esgotados) ou 429 (rate limit persistente), tentar automaticamente OpenAI e depois Gemini com chaves próprias armazenadas no master, mantendo a mesma interface para todas as edge functions de IA.

## Cadastro das chaves (Master)

- Adicionar dois campos criptografados em `platform_settings` (já usado para Resend/ElevenLabs):
  - `openai_api_key_encrypted`
  - `gemini_api_key_encrypted`
- Página **Master → Platform Settings**: nova seção "Fallback de IA" com formulários para colar/rotacionar/limpar cada chave e um botão "Testar" (faz um `models.list` ou `generateContent` mínimo para validar).
- Edge functions novas (espelham o padrão do Resend/ElevenLabs):
  - `openai-master-set` / `openai-master-clear` / `openai-master-test`
  - `gemini-master-set` / `gemini-master-clear` / `gemini-master-test`
- As chaves ficam salvas cifradas em `platform_settings` e são lidas apenas por `service_role` (nunca vão pro browser).

## Camada compartilhada — `_shared/ai-gateway.ts`

Refatorar `chatCompletion` e `createEmbedding` para usar uma cadeia de provedores:

1. **Lovable Gateway** (primário) — comportamento atual.
2. **OpenAI direto** (`https://api.openai.com/v1`) — se disponível.
3. **Google Gemini** (`https://generativelanguage.googleapis.com`) — via endpoint OpenAI-compat `/v1beta/openai/chat/completions`.

Regras da cadeia:
- Tenta o próximo provedor apenas em **402** (créditos), **401/403** relacionados ao gateway, ou **429/5xx** transientes após 1 retry.
- **400** (schema/modelo inválido) e **200** não caem para fallback.
- Cada provedor recebe o modelo mapeado (tabela `MODEL_MAP`):
  - `openai/gpt-5.5` → OpenAI `gpt-4o` (ou `gpt-4.1` quando disponível) / Gemini `gemini-2.5-pro`
  - `openai/gpt-5-mini` / `gpt-5.4-mini` → OpenAI `gpt-4o-mini` / Gemini `gemini-2.5-flash`
  - `google/gemini-3-flash-preview` / `gemini-2.5-flash` → OpenAI `gpt-4o-mini` / Gemini `gemini-2.5-flash`
  - default → `gpt-4o-mini` / `gemini-2.5-flash`
- Embeddings: OpenAI `text-embedding-3-small` (1536 dims) / Gemini `text-embedding-004`. Se as dimensões divergirem do modelo primário (Gemini embedding-001 = 768), avisar no log — as tabelas atuais já usam 768; então priorizar `text-embedding-004` (768) no fallback.
- Retorno normalizado inclui `provider_used: "lovable" | "openai" | "gemini"` e `model_used` para os callers.

## Log em audit_logs

- Sempre que o fallback for acionado (Lovable falhou e um provedor secundário respondeu), registrar em `audit_logs`:
  - `event_type = "ai_fallback_triggered"`
  - `severity = "warn"` (ou `"error"` se todos falharam)
  - `metadata = { primary_status, provider_used, model_requested, model_used, edge_function, run_id }`
- Feito via `_shared/audit-log.ts` já existente, com `service_role`.
- Se **todos** os provedores falharem: `severity = "critical"` e o erro sobe pra edge chamadora (mantém comportamento atual de 402/429/500).

## Cobertura (todas as edges de IA)

Como o refactor é no `_shared/ai-gateway.ts`, todas essas funções ganham fallback automaticamente:
- `sdr-agent`, `cadence-agent-decide`, `generate-reply`, `hook7-webhook` (via transcribe)
- `analyze-historical-wins`, `analyze-lead-website`, `annotate-decision`
- `classify-intent`, `extract-referral-name`, `extract-knowledge`, `embed-knowledge`
- `summarize-conversation`, `enrich-lead`, `render-template-slots`
- `preview-cadence-messages`, `generate-pending-first-messages`, `cadence-simulate-reply`
- `human-suggest-reply`, `human-offer-slots`

As três functions que ainda usam `fetch` direto ao gateway (`ai-generate-script`, `ai-reply`, `ai-variations`) serão migradas pra `chatCompletion` do shared para herdar o fallback.

Transcrição de áudio (`_shared/transcribe-audio.ts`) já tem cadeia própria (ElevenLabs → Gemini) — fica fora deste escopo.

## UI

- Badge em **Master Dashboard**: pequeno indicador quando houve fallback nas últimas 24h (contando `audit_logs` com `event_type = ai_fallback_triggered`).
- Nova aba/coluna em **Master → Logs** filtrando esse `event_type` (já existe filtro por severidade — só documentar).

## Detalhes técnicos

- `MODEL_MAP` em `_shared/ai-model-map.ts` para uma fonte só.
- OpenAI: header `Authorization: Bearer ${OPENAI_API_KEY}`. Suporta tools/`tool_calls` no mesmo shape.
- Gemini: usar endpoint OpenAI-compat `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` com `Authorization: Bearer ${GEMINI_API_KEY}` — mantém o mesmo shape (messages, tools, tool_choice). Testar tool-calling do sdr-agent num run isolado antes de dar merge — Gemini é sensível a schemas com enums grandes.
- `estimateCostUsd` em `src/lib/ai-pricing.ts` recebe entradas de `gpt-4o` / `gemini-2.5-flash` (já existem na tabela); adicionar `gpt-4o-mini` e `text-embedding-3-small`/`004`.
- Nunca expor as chaves ao browser (`VITE_*` proibido). As chaves só existem no ambiente das edge functions via `platform_settings`, carregadas por helper `getFallbackKeys()` cacheado por request.

## Fora do escopo

- Não muda o modelo primário do SDR nem o comportamento em sucesso.
- Não implementa fallback pra image-gen (image gen só usa Gemini hoje).
- Não altera limites de créditos nem billing.
