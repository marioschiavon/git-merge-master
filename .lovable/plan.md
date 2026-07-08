# Ação

Salvar o plano de melhoria da análise de leads (opção A — Firecrawl) como documento versionado, sem alterar código.

## Arquivo a criar

`docs/melhoria-analise-lead-firecrawl.md`

## Conteúdo do documento

Vai conter, em português:

1. **Contexto e diagnóstico**
   - Feedback do cliente: insights genéricos (resumo, produtos, dores).
   - Causas identificadas via investigação em `lead_insights` reais:
     - Fetch simples não executa JS → sites SPA retornam pouco conteúdo.
     - Só a home é lida.
     - Prompt não exige evidência → IA inventa produtos plausíveis.
     - Modelo único `gemini-2.5-flash`, sem fallback.

2. **Escopo da mudança** (só backend, arquivo `supabase/functions/analyze-lead-website/index.ts`)

3. **Passos de implementação**
   - Conectar Firecrawl via `standard_connectors--connect` (`FIRECRAWL_API_KEY`).
   - Novo helper `scrapeWithFirecrawl(website)`:
     - `/v2/map` (limit 30) → filtra links por keywords (`sobre|produto|servico|solucao|cliente|case|contato|equipe|empresa`) → até 5 páginas + home.
     - `/v2/scrape` com `formats: ['markdown','summary']`, `onlyMainContent: true`.
     - Concatena `[URL]\n<markdown>` e trunca em ~25k chars.
   - Fallback pro fetch atual se `FIRECRAWL_API_KEY` ausente.
   - Reescrita "evidence-first" do system prompt:
     - Cada `produtos`, `diferenciais`, `cases`, `pain_points` precisa de trecho literal (≤120 chars) + `url_origem`.
     - Sem evidência ⇒ item não pode aparecer (preferir array vazio).
     - `score_breakdown[].reason` também cita trecho + URL.
   - Cascata de modelo:
     1. `google/gemini-2.5-pro`
     2. `google/gemini-2.5-flash` (429/5xx)
     3. `openai/gpt-5-mini` (402)
   - Persistir `scrape_meta` dentro de `lead_insights.insights` (sem schema change):
     - `pages_scraped: [{ url, chars }]`
     - `provider: 'firecrawl' | 'fetch'`
     - `model_used`

4. **Fora de escopo**
   - Não muda UI, hooks, `buildScorePayload` nem fit/score logic.
   - Não mexe em outras edge functions.

5. **Custo/latência estimados**
   - ~6 créditos Firecrawl por lead.
   - Latência sobe de ~5s para ~15–25s (análise é async, aceitável).

6. **Validação depois de implementar**
   - Rodar em 3 leads (SPA pesado, WordPress simples, site quebrado).
   - Conferir `scrape_meta`.
   - Cada `produtos` / `pain_points` deve ter trecho literal + URL.
   - Comparar `resumo` novo vs antigo.

## Status dos P0 do `guia-liderei-prospeccao.md`

Verificado no código:

**P0 #1 — Score configurável por cliente + coluna numérica** — ✅ **Concluído**
- `companies.scoring_prompt`, `scoring_include`, `scoring_exclude` existem.
- Hook `useScoring` + UI em `Settings.tsx` (aba Qualificação).
- `analyze-lead-website` já injeta `scoringBlock` no prompt e devolve `score` (0–100) + `score_breakdown`.

**P0 #2 — Controle de volume no enriquecimento** — ✅ **Concluído**
- `enrichLimit` no `LeadImportDialog` e `ApolloSearch`.
- Status `enrichment_status='not_queued'` no `Leads.tsx`.
- Edge function `enrichment-enqueue-more` para enfileirar mais N.

**Conclusão:** os dois P0 estão prontos. A melhoria de Firecrawl (este documento) é evolução do P0 #1 (qualidade dos insights que alimentam o score), mas o P0 em si já está fechado. Próximos gaps do guia são P1 (revisão em massa, scraping LinkedIn/IG).

## Sem alterações de código nesta rodada

Apenas 1 arquivo novo: `docs/melhoria-analise-lead-firecrawl.md`.
