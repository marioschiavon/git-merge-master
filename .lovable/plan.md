# Métricas de IA no painel Master

Hoje o painel Master (`/master`) mostra apenas cards zerados no `MasterDashboard.tsx` e a lista de empresas em `Companies.tsx`. Não há visibilidade de consumo de IA para precificar clientes.

A tabela `sdr_agent_runs` já registra por execução do agente: `company_id`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `created_at`. Vamos usá-la como fonte da verdade para o MVP dessa visão.

## O que vai aparecer

### 1. `MasterDashboard.tsx` — visão global
Substituir os 4 cards estáticos por dados reais dos últimos 30 dias:
- **Empresas ativas** (companies where status in active/trial)
- **Tokens consumidos (30d)** — soma de `total_tokens`
- **Custo estimado (30d)** — em USD e BRL (com cotação fixa configurável no código, ex. 5,20)
- **Modelo mais usado** — modelo com maior share de tokens

Abaixo, dois blocos:
- **Consumo por modelo (30d)** — tabela: modelo · runs · prompt tokens · completion tokens · custo estimado
- **Top 10 empresas por consumo (30d)** — tabela: empresa · runs · total tokens · custo estimado

Filtro de período: 7d / 30d / 90d (default 30d).

### 2. `Companies.tsx` — por empresa
Adicionar 3 colunas na tabela existente:
- **Runs (30d)**
- **Tokens (30d)**
- **Custo est. (30d)** — em BRL

Buscadas em uma única query agrupada por `company_id` para não fazer N+1.

### 3. Tabela de preços (código, não UI)
Novo arquivo `src/lib/ai-pricing.ts` com preço por 1M tokens (input/output) para cada modelo que aparece em `sdr_agent_runs.model`. Função `estimateCostUsd(model, promptTokens, completionTokens)`. Cotação USD→BRL como constante no topo, editável.

Valores iniciais (baseados nos modelos usados no projeto — `openai/gpt-5`, `google/gemini-2.5-flash`, etc.):

```text
openai/gpt-5              → in $1.25 / out $10.00 por 1M
openai/gpt-5-mini         → in $0.25 / out $2.00 por 1M
openai/gpt-5-nano         → in $0.05 / out $0.40 por 1M
google/gemini-2.5-pro     → in $1.25 / out $10.00 por 1M
google/gemini-2.5-flash   → in $0.30 / out $2.50 por 1M
google/gemini-2.5-flash-lite → in $0.10 / out $0.40 por 1M
default (desconhecido)    → in $1.00 / out $3.00 por 1M
```

Deixarei um comentário claro no arquivo dizendo que são valores de referência e devem ser revisados quando os preços do gateway mudarem.

## Detalhes técnicos

- **Fonte dos dados:** consulta direta a `sdr_agent_runs` via `supabase.from(...)` — como só é acessada por master admin (rota protegida por `RequireMasterAdmin`) e a RLS já cobre.
- **Agregação no cliente:** para simplicidade, faço `select("company_id, model, prompt_tokens, completion_tokens, total_tokens, created_at")` filtrando por `created_at >= now - 30d` e agrego em memória (volume esperado é baixo — dá para paginar depois se crescer).
- **Limitação conhecida:** `sdr_agent_runs` só cobre o agente SDR. Chamadas como `analyze-lead-website`, `ai-variations`, `generate-reply` não estão nela. Vou adicionar uma nota no card de custo dizendo *"Considera apenas execuções do agente SDR"*. Ampliar para todas as chamadas fica como próximo passo (exigiria uma tabela unificada de logs de IA — fora do escopo desta rodada).
- **Sem mudança de schema.** Sem migration. Só frontend + um arquivo utilitário.

## Arquivos alterados

- `src/lib/ai-pricing.ts` — novo, tabela de preços + `estimateCostUsd` + `USD_TO_BRL`
- `src/hooks/useMasterAiUsage.ts` — novo, hook que faz a query agregada e devolve `{ byModel, byCompany, totals }`
- `src/pages/master/MasterDashboard.tsx` — reescreve cards + adiciona 2 tabelas + seletor de período
- `src/pages/master/Companies.tsx` — adiciona 3 colunas de consumo por empresa

## Fora de escopo

- Rastrear IA fora do agente SDR (edge functions avulsas)
- Persistir cotação USD→BRL em `platform_settings`
- Exportar CSV
- Gráficos (só tabelas nesta rodada)
