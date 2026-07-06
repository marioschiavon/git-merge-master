
## Contexto

Hoje a coluna "Status de enriquecimento" reflete só o job técnico (`leads.enrichment_status`: pending / processing / completed / failed). Isso mostra "Enriquecido" mesmo quando `lead_insights` veio vazio (sem website, sem análise IA), como Thiago e Adilson. O usuário quer um sinal claro de "tem munição pra rodar fluxo" x "faltam dados".

## Minha recomendação

Manter `enrichment_status` como está (é o estado do job) e **adicionar um segundo badge derivado**, calculado no front a partir de `lead_insights` + campos do lead. Sem mudança de schema, sem migração — só UI + uma função utilitária.

### Regra proposta (`getLeadReadiness(lead, insight)`)

- **`ready` → "Pronto" (verde)**
  Tem `lead_insights` com `value_proposition` **e** (`business_summary` ou `pain_points` não vazio). Ou seja, a IA conseguiu extrair proposta de valor + contexto.

- **`partial` → "Parcial" (azul)**
  Tem `lead_insights` mas falta proposta de valor OU contexto de negócio. Enriquecimento rodou mas rendeu pouco.

- **`needs_review` → "Revisar" (âmbar)**
  `enrichment_status = completed` mas **sem** `lead_insights` (nenhuma linha) e sem `website`/redes sociais úteis. É o caso Thiago/Adilson — nada pra puxar, precisa completar dados manualmente.

- **`processing` → "Enriquecendo…"** (mantém o atual quando `enrichment_status` in pending/processing).

- **`failed` → "Falhou"** (mantém).

Se você preferir outros nomes ("Analisar", "Pendente"), troco fácil — minha sugestão é **"Pronto" / "Parcial" / "Revisar"** porque descreve ação, não estado técnico.

## Onde aparece

1. **Tabela `/leads`** — substitui o badge `enrichmentLabels` atual pelo novo badge de "readiness". Mantém tooltip explicando o motivo (ex.: "Sem proposta de valor extraída — clique para revisar").
2. **`LeadDetailContent`** — mostra o mesmo badge no topo, ao lado do nome, com CTA:
   - `needs_review` → botão "Adicionar website/redes e reprocessar".
   - `partial` → botão "Reanalisar website" (chama `analyze-lead-website`).
   - `ready` → sem CTA, badge verde.

## Implementação (frontend apenas)

### Novo arquivo: `src/lib/lead-readiness.ts`
Função pura `computeReadiness(lead, insight)` → `{ key, label, cls, tooltip }`. Sem side-effects, fácil de testar.

### `src/pages/Leads.tsx`
- Buscar `lead_insights` em batch (uma query `.in('lead_id', ids)`) via novo hook `useLeadInsightsBatch(leadIds)`.
- Trocar `enrichmentLabels[...]` pelo `computeReadiness(lead, insightsMap[lead.id])`.

### `src/components/LeadDetailContent.tsx`
- Usar `useLeadInsights(lead.id)` (já existe) + `computeReadiness` para renderizar badge + CTA contextual.

### `src/hooks/useLeadInsights.ts`
- Adicionar `useLeadInsightsBatch(leadIds: string[])` para não fazer N queries na listagem.

## O que **não** muda

- Schema / migrations: nenhum.
- Edge functions (`enrich-lead`, `analyze-lead-website`): nenhum.
- `leads.enrichment_status`: continua sendo escrito pelo job — apenas deixa de ser o único sinal exibido.

## Perguntas antes de partir pro código

1. Nomes: **"Pronto / Parcial / Revisar"** OK, ou prefere **"Enriquecido / Parcial / Analisar"**?
2. Quer que **"Revisar"** também apareça quando `enrichment_status = failed`? (hoje eu deixaria "Falhou" separado, porque é problema técnico, não falta de dado).
3. A regra de `ready` deve exigir também `company_knowledge` (base RAG) preenchido, ou só `lead_insights` basta?
