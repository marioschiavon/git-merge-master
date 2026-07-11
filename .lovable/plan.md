## Diagnóstico

- **Score:** só é escrito em `leads.score` pela função `analyze-lead-website` (botão "Analisar Website" em `LeadDetailContent.tsx:403`). O prompt já injeta `scoring_prompt`/`scoring_include`/`scoring_exclude` da empresa (`analyze-lead-website/index.ts` linhas 235-285), mas hoje não há log/feedback do que a IA usou, e o front não distingue "score recalculado" de "score inalterado".
- **Scrap Apify:** dispara em `enrich-lead` (`index.ts:369-411`) já checando `lead.instagram_url` / `linkedin_url` / `linkedin_company_url`. Porém só nasce job pelo trigger `enqueue_lead_enrichment` na criação — **editar a URL depois não refaz o scrap**, e o botão "Analisar" só chama `analyze-lead-website`.
- **Filtro de data:** **inexistente**. `normalizeInstagramPosts` e `summarizePosts` só cortam por quantidade (`slice(0, 30)` / `slice(0, 12)`); LinkedIn/Facebook idem. `build-first-message.ts` e `preview-cadence-messages/index.ts` também não filtram.

## O que vou fazer

### 1. Score sempre alinhado à Qualificação da empresa

O ponto central desta rodada. Em `supabase/functions/analyze-lead-website/index.ts`:

- **Guardrail server-side:** se a empresa tiver `scoring_prompt` / `scoring_include` / `scoring_exclude` cadastrados e a IA devolver `score` sem `score_breakdown` referenciando esses critérios, **rejeitar e reprocessar** com uma segunda tentativa exigindo breakdown por critério. Se ainda vier vazio, força `score = null` + `fit_score = "low"` e `fit_reason` explicando que faltou evidência para os critérios definidos.
- **Anti-fit rígido:** se qualquer termo de `scoring_exclude` aparecer no conteúdo do site OU no `raw_summary`, teto de `score = 20` e `fit_score = "low"`, mesmo que a IA discorde. Isso vai para o backend, não confia na IA.
- **Pró-fit rastreável:** para cada termo de `scoring_include` encontrado no conteúdo, adicionar entrada em `score_breakdown` com `criterion: "match:<termo>"`, `reason: "<trecho literal ≤120 chars>"`, `url_origem`.
- **`score_changed` no retorno:** a resposta da edge passa a incluir `old_score`, `new_score`, `score_changed` (boolean) e `reason` ("recalculado com Qualificação atual" ou "sem sinal novo — mantido"). Sobrescreve `leads.score` sempre (o usuário confirmou "só quando houver dado novo" — o "novo" aqui inclui **mudança em `companies.scoring_*`** desde a última análise; comparamos `lead_insights.analyzed_at` com `companies.updated_at`).
- **Log detalhado** dos critérios usados, termos batidos e resposta bruta da IA em `console.log` para inspeção via edge function logs.
- Front (`useLeadInsights.ts` + `LeadDetailContent.tsx`): toast diferenciando "Score atualizado: X → Y" / "Nenhum sinal novo — score mantido em X" / "Score bloqueado por anti-fit: <termo>".

### 2. Scrap automático de Instagram / LinkedIn

Encadear o scrap em três gatilhos (todos escolhidos pelo usuário):

**a) Criação/importação** — já funciona via trigger `enqueue_lead_enrichment`, mantém.

**b) URL alterada depois** — nova migration com trigger `BEFORE UPDATE ON public.leads`:
```sql
IF NEW.instagram_url IS DISTINCT FROM OLD.instagram_url
   OR NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url
   OR NEW.linkedin_company_url IS DISTINCT FROM OLD.linkedin_company_url
   OR NEW.facebook_url IS DISTINCT FROM OLD.facebook_url THEN
  NEW.enrichment_status := 'pending';
END IF;
```
O trigger `enqueue_lead_enrichment` existente cuida do resto. Em `enrich-lead/index.ts`, quando o job for de "URL mudou", pular website_analysis inteiro e rodar só o Apify das redes com URL nova (comparando com `lead_social_profiles.source_url`).

**c) Botão "Analisar"** — `LeadDetailContent.tsx` passa a invocar `analyze-lead-website` **e** `enrich-lead` em paralelo com `{ force: true }`. Novo parâmetro `force` em `enrich-lead` ignora cache do Apify e refaz o scrap das redes preenchidas. Score depois consome os posts frescos.

### 3. Filtro de recência — últimos 90 dias

Aplicado em três pontos:

**a) `enrich-lead/index.ts`** — `normalizeInstagramPosts` e handlers LinkedIn (`postedAt`/`postedDate`) e Facebook (`time`):
```ts
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const cutoff = Date.now() - NINETY_DAYS_MS;
const recent = (raw || [])
  .map(p => ({ ...p, _ts: p.timestamp ? Date.parse(p.timestamp) : 0 }))
  .filter(p => p._ts >= cutoff)
  .sort((a, b) => b._ts - a._ts)
  .slice(0, 30);
```
Se ficar zero, gravar `recent_posts: []` e `posts_summary: "Sem publicações nos últimos 90 dias."` em vez de misturar posts velhos.

**b) `summarizePosts()`** — recebe já filtrado; ignorar itens com `_ts=0`.

**c) `_shared/build-first-message.ts` e `preview-cadence-messages/index.ts`** — aplicar mesmo filtro antes do `slice(0, 3)` como salvaguarda para dados antigos ainda em `lead_social_profiles`.

### 4. Sinalização visual

`LeadSocialCard.tsx`: mostrar data do post mais recente por rede e badge "Sem posts recentes (últimos 90 dias)" quando `recent_posts` vazio.

## Detalhes técnicos

- **Migration:** trigger `BEFORE UPDATE ON public.leads` que zera `enrichment_status → 'pending'` quando URL de rede muda.
- **Arquivos editados:**
  - `supabase/functions/analyze-lead-website/index.ts` — reforço de Qualificação, anti-fit, `score_changed`, logs, comparação com `companies.updated_at`.
  - `supabase/functions/enrich-lead/index.ts` — janela 90d em IG/LI/FB, modo `force`, escopo por rede quando disparado por mudança de URL.
  - `supabase/functions/_shared/build-first-message.ts` — filtro 90d.
  - `supabase/functions/preview-cadence-messages/index.ts` — filtro 90d.
  - `src/hooks/useLeadInsights.ts` — expor `score_changed`, `old_score`, `new_score`, `reason`.
  - `src/components/LeadDetailContent.tsx` — botão "Analisar" chama `analyze-lead-website` + `enrich-lead` (force); toast com resultado real.
  - `src/components/LeadSocialCard.tsx` — badge "sem posts nos últimos 90 dias" + data do último post.
- **Deploy:** redeployar `analyze-lead-website`, `enrich-lead`, `preview-cadence-messages`.
- Fora de escopo: mexer em `enrichment_settings.apify_scrape`, refatorar `sdr-agent`, migrar shape dos arrays de insights.
