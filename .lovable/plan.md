
## Ação de arquivo
- Copiar o guia enviado para `docs/guia-liderei-prospeccao.md` (fica versionado junto ao código, sem alterar `.lovable/memory`).
- Adicionar uma linha no `mem://index.md` apontando para o guia como referência viva de produto.

---

## Diagnóstico seção por seção

Legenda: ✅ pronto · ⚠️ parcial · ❌ falta

### §2 — Base de Conhecimento multi-tenant
- ✅ **KB Comercial por cliente**: tabela `knowledge_base` com `company_id`, hook `useKnowledge`, tipos `text/url/document/highlights/ai_instructions`, embeddings (`embed-knowledge`), página `/knowledge`.
- ✅ **RLS por company_id** garante isolamento (memória `mem://features/multi-tenancy`).
- ⚠️ **Origem "kickoff/discovery"**: hoje entrada é manual (texto/URL/upload). Não há fluxo dedicado para colar transcrição de kickoff e gerar resumo estruturado automaticamente.
- ❌ **Permissão granular "cliente não pode editar dados do kickoff, mas pode adicionar complementos"**: não existe. Qualquer `company_admin` edita tudo. Falta flag tipo `locked_by_admin` / origem `kickoff` protegida.
- ⚠️ **KB do Lead (§2.2)**: existe `lead_insights` (proposta_valor, raw_summary, analyzed_at) gerada por `analyze-lead-website`. Cobre site; **LinkedIn e Instagram não são scrapados** — só o que vem do Apollo (headline/summary já embutido no perfil). Instagram não é coletado em lugar nenhum.

### §3 — Fluxo operacional ponta a ponta
| Etapa | Status |
|---|---|
| 1. Import (Apollo + CSV) | ✅ `apollo-search`/`apollo-import` + `LeadImportDialog` |
| 2. Escolha de quantos enriquecer | ❌ **Falta** (ver §4) |
| 3. Enriquecimento site/LinkedIn/IG | ⚠️ Só site (`analyze-lead-website` + `enrich-lead`); LinkedIn parcial (via Apollo), IG inexistente |
| 4. Geração da KB individual do lead | ✅ `lead_insights` |
| 5. Qualificação/Score | ❌ **Falta score numérico configurável** (ver §5) |
| 6. Filtro aceitar/descartar antes da cadência | ⚠️ Existe `lead-readiness` (Pronto/Revisar/Novo) mas é derivado, não é decisão explícita do usuário com bulk-approve |
| 7. Geração de mensagens personalizadas | ✅ `generate-pending-first-messages`, `ai-generate-script`, `preview-cadence-messages` usam KB + insights |
| 8. Disparo cadência WhatsApp | ✅ `cadence-executor` + Z-API/Twilio + `hook7-*` |

### §4 — Controle de volume no enriquecimento
- ❌ **Não implementado**. Hoje `enrichment-cron` roda de 5 em 5 jobs pending sem cap por lista/importação. O usuário não escolhe "enriquecer 200 destes 5.000".
- Precisa: seletor no `LeadImportDialog` / `ApolloSearch` ("quantos leads enriquecer agora?"), enfileirar só esses N em `lead_enrichment_jobs`, deixar restante como `enrichment_status='not_queued'`, e botão "enriquecer mais N" na lista.

### §5 — Qualificação e Score
- ⚠️ Existe apenas `fit_score: high|medium|low` textual retornado por `analyze-lead-website` (prompt genérico global), sem critério configurável por cliente e sem valor numérico 0-100.
- ⚠️ Existe `min_fit_score` em `agentic_cadences` mas é numérico e não bate com o high/medium/low de hoje — meia-implementação.
- ❌ **Prompt de score configurável por cliente**: não existe UI nem coluna. Precisa: `companies.scoring_prompt` (texto livre, tipo prompt) + `companies.scoring_keywords_include[]` / `..._exclude[]`.
- ❌ **Score numérico por lead** persistido em `lead_insights` (ex.: `score`, `score_breakdown jsonb` por critério).
- ❌ **Revisão em massa antes da cadência**: falta ação bulk "aprovar N leads → enrolar em cadência" / "descartar" na página `/leads` filtrando por score.

### §6 — Geração de mensagens
- ✅ Combina KB comercial (`highlights`, `ai_instructions`) + insights do lead + objetivo da cadência.
- ⚠️ Não puxa explicitamente "histórico do que funcionou/não funcionou" (§2.1). Poderia alimentar a partir de `bookings` confirmados / cadências campeãs.

### §7 — Qualidade sobre volume
- ⚠️ Cadência tem HITL gate, aprovações, `min_fit_score`. Não há guard-rail explícito ligado ao score configurável (porque score não existe).

### §8 — Próximos passos do guia
- Kickoff Raquel → **fora do app** (operacional).
- Multi-tenant da KB de scraping → ⚠️ `lead_insights` já é por company via RLS, mas o **prompt de análise em `analyze-lead-website` é global**. Precisa passar a usar `scoring_prompt` e `highlights` da company.
- Integração Apollo → ✅ pronta (`apollo-connect/search/import/status`).
- Pipedrive → ✅ confirmado no turno anterior.
- Cadência WhatsApp para testes → ✅.
- Campo de critério/score configurável → ❌ (item central).
- Controle de quantidade a enriquecer → ❌.

---

## Gaps priorizados (ordem sugerida de implementação futura)

1. **P0 — Score configurável por cliente + coluna numérica no `lead_insights`**
   - Coluna `companies.scoring_prompt` (text), `scoring_include` / `scoring_exclude` (text[]).
   - UI em `/settings` (aba "Qualificação de Leads").
   - `analyze-lead-website` passa a receber o prompt do cliente e devolve `score` (0-100) + `score_breakdown`.
   - Migrar `min_fit_score` das cadências para bater com 0-100.

2. **P0 — Controle de volume no enriquecimento**
   - Campo "Quantos enriquecer agora?" no `LeadImportDialog` e no `ApolloSearch` (default 100–200).
   - `enrichment_status='not_queued'` para o restante; botão "enriquecer mais N" na `/leads` e na `LeadList`.

3. **P1 — Revisão/aprovação em massa antes da cadência**
   - Filtro por score em `/leads` + ações bulk "Enviar para cadência X" / "Descartar".

4. **P1 — Scraping de LinkedIn e Instagram no `enrich-lead`**
   - Provider (ex.: Apify/ScrapingBee) atrás de secret; fallback grácil se offline.
   - Merge no `lead_insights` (`linkedin_summary`, `instagram_summary`).

5. **P2 — KB de kickoff protegida**
   - Coluna `knowledge_base.origin` (`kickoff` | `client` | `admin`) + flag `locked`. Policy RLS: `company_admin` só edita `origin != 'kickoff'` a menos que seja `master_admin`.
   - Ação "Colar transcrição de kickoff" que roda `extract-knowledge` e grava com `origin='kickoff', locked=true`.

6. **P2 — Alimentar KB comercial com "o que funcionou"**
   - Job periódico que resume cadências com maior taxa de booking e injeta como `type='historical_wins'` nas queries de geração de mensagem.

---

## Validação após salvar o guia
- `docs/guia-liderei-prospeccao.md` renderiza no GitHub.
- `mem://index.md` referencia o guia.
- Nenhum código de app é alterado nesta rodada — implementação dos gaps entra em plano separado quando você priorizar.
