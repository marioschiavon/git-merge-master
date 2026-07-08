# Melhoria da análise de lead — Firecrawl + evidence-first

Status: **Planejado (não implementado)** — pendente de execução em rodada futura.
Escopo: apenas backend, edge function `supabase/functions/analyze-lead-website/index.ts`.
Origem: feedback do cliente de que os insights (resumo, produtos, dores) estão genéricos demais.

---

## 1. Contexto e diagnóstico

Investigação em `lead_insights` reais (ex.: Secretaria de Jaboticabal) mostrou que a IA está inventando produtos/módulos plausíveis mas não verificáveis. As causas raiz:

1. **Fetch simples não executa JS.** Em sites institucionais/SPA volta pouco HTML útil, mas o pipeline manda para a IA mesmo assim.
2. **Só a home é lida.** Páginas ricas (`/sobre`, `/produtos`, `/servicos`, `/clientes`, `/cases`) ficam de fora.
3. **Prompt não exige evidência.** Campos como `produtos`, `pain_points`, `diferenciais` podem ser livremente inventados.
4. **Modelo único `gemini-2.5-flash`, sem fallback.** Bom para custo/latência, porém mais propenso a "encher linguiça" quando o insumo é pobre.

Entra pouco conteúdo → sai texto de marketing genérico com fatos não verificáveis.

---

## 2. Escopo

- Apenas backend: `supabase/functions/analyze-lead-website/index.ts`.
- **Não muda** UI, hooks, `buildScorePayload`, `normalizeScore` nem lógica de fit/score.
- **Não mexe** em outras edge functions.

---

## 3. Passos de implementação

### 3.1. Conectar Firecrawl

- `standard_connectors--connect` com `firecrawl` → expõe `FIRECRAWL_API_KEY` como env var na edge function.
- Fallback: se `FIRECRAWL_API_KEY` não estiver presente, a função continua funcionando via `tryFetch` atual (modo degradado, mantém compatibilidade).

### 3.2. Novo helper `scrapeWithFirecrawl(website)`

Fluxo:

```
1. POST https://api.firecrawl.dev/v2/map
   body: { url: website, limit: 30 }
2. Filtrar links por keyword:
   sobre|about|produto|servico|solucao|cliente|case|contato|equipe|empresa
   → limitar a 5 páginas
3. Sempre incluir a home
4. Para cada página (paralelo, com concorrência 3):
   POST https://api.firecrawl.dev/v2/scrape
   body: {
     url,
     formats: ['markdown', 'summary'],
     onlyMainContent: true
   }
5. Concatenar em blocos: `[URL: <url>]\n<markdown>\n\n---\n\n`
6. Truncar em ~25.000 chars
```

Retorno:

```ts
{
  pages: { url: string; chars: number }[],
  provider: 'firecrawl' | 'fetch',
  content: string
}
```

### 3.3. Reescrita "evidence-first" do system prompt

Novas regras obrigatórias:

- Cada item de `produtos`, `diferenciais`, `cases`, `pain_points` **precisa** trazer:
  - um trecho literal (≤ 120 chars) copiado do site
  - `url_origem` da página onde o trecho apareceu
- Item sem evidência → **não pode aparecer** (preferir array vazio a inventar).
- `score_breakdown[].reason` também precisa referenciar trecho literal + URL.
- Regra explícita: *"não parafraseie clichês de marketing; se o site não diz, retorne vazio."*

Retrocompatibilidade: os arrays continuam sendo `string[]`, no formato `"Nome — 'trecho literal' (url)"`. Sem migração de UI.

### 3.4. Cascata de modelo

Substituir a chamada única atual por `callAiWithFallback(messages)`:

```
1. google/gemini-2.5-pro       (principal — mais fiel em contexto grande)
2. google/gemini-2.5-flash     (fallback em 429/5xx)
3. openai/gpt-5-mini           (fallback em 402)
```

Mesmo prompt/schema em todos os degraus. Se todos falharem → 502 com detalhe do último erro.

### 3.5. Meta do scrape

Persistir dentro de `lead_insights.insights.scrape_meta` (JSON, **sem schema change**):

```json
{
  "scrape_meta": {
    "pages_scraped": [
      { "url": "https://ex.com/", "chars": 4820 },
      { "url": "https://ex.com/sobre", "chars": 3100 }
    ],
    "provider": "firecrawl",
    "model_used": "google/gemini-2.5-pro"
  }
}
```

Serve para debug e evolução sem migração.

---

## 4. Custo e latência esperados

- Firecrawl: 1 `map` + até 5 `scrape` ≈ **~6 créditos por lead**.
- IA: `gemini-2.5-pro` custa mais que `flash`, mas roda 1x por lead.
- Latência sobe de ~5s para **~15–25s**. Aceitável — análise é assíncrona.

---

## 5. Validação depois de implementar

1. Rodar em 3 leads representativos:
   - SPA pesado (site que hoje volta quase nada).
   - WordPress institucional simples.
   - Site quebrado / com timeout.
2. Conferir `lead_insights.insights.scrape_meta` em cada um.
3. Ler `produtos` e `pain_points` — cada item precisa ter trecho literal + URL.
4. Comparar `resumo` novo vs. antigo do mesmo lead.
5. Checar logs da edge function por 24h para confirmar que a cascata de modelos ativa quando esperado.

---

## 6. Status dos P0 do `guia-liderei-prospeccao.md`

Verificado no código em 08/07/2026:

**P0 #1 — Score configurável por cliente + coluna numérica** — ✅ Concluído
- Colunas `companies.scoring_prompt`, `scoring_include`, `scoring_exclude`.
- Hook `useScoring` + UI em `src/pages/settings/Settings.tsx` (aba Qualificação).
- `analyze-lead-website` já injeta `scoringBlock` no prompt e devolve `score` (0–100) + `score_breakdown` normalizados.

**P0 #2 — Controle de volume no enriquecimento** — ✅ Concluído
- `enrichLimit` no `LeadImportDialog` e `ApolloSearch`.
- Status `enrichment_status='not_queued'` para o restante.
- Edge function `enrichment-enqueue-more` para enfileirar mais N a partir da `/leads`.

**Conclusão:** os dois P0 estão prontos. Esta melhoria de Firecrawl é uma **evolução do P0 #1** (qualidade do insumo que alimenta o score), não um P0 pendente. Próximos gaps do guia são P1 (revisão em massa antes da cadência) e P1 (scraping de LinkedIn/Instagram no `enrich-lead`).
