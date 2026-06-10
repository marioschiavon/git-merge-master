## Objetivo

Após o enriquecimento, exibir automaticamente:
1. **No painel do lead** — os insights da análise do website (sem precisar clicar em "Analisar Website").
2. **Na aba "Leads" da cadência (/cadences)** — a 1ª mensagem de aproach inline em cada card, sem precisar abrir o lead.

---

## 1. Insights do website automáticos no painel do lead

**Diagnóstico**: o `enrich-lead` já grava em `lead_insights` quando `settings.website_analysis = true`. O `LeadDetail.tsx` já consulta `useLeadInsights`. Se o painel ainda mostra "Clique em Analisar Website", é porque (a) a setting estava desativada, ou (b) o enriquecimento falhou silenciosamente, ou (c) o lead foi criado antes da feature.

**Mudanças em `src/components/LeadDetail.tsx`**:
- Quando `lead.website` existir, `insights` estiver vazio e `enrichment_status === 'completed'`, disparar `analyzeWebsite.mutate(lead.id)` automaticamente uma única vez (via `useEffect`, com guard por `leadId`).
- Substituir a mensagem "Clique em Analisar Website…" por um estado de loading ("Analisando website…") enquanto roda.
- Manter o botão "Reanalisar" para refazer manualmente.

**Mudança em `supabase/functions/enrich-lead/index.ts`**:
- Garantir `website_analysis` rodando sempre que `lead.website` existir **e** qualquer flag de enriquecimento estiver ativa (não exigir a flag específica). Isso alinha com a expectativa do usuário ("após enriquecimento já vem a análise").
- Alternativa mais conservadora: só ativar autoanálise no front. Vou aplicar **ambas**: backend tenta, front faz fallback se faltar.

---

## 2. Pré-visualização da 1ª mensagem inline em /cadences → aba Leads

**Mudanças em `src/components/CadenceDetail.tsx`**:
- Para cada `enrollment` na aba Leads, exibir abaixo do nome um bloco compacto com:
  - Canal + assunto (se email) da **Step 1**.
  - Corpo da mensagem (primeiros ~3 linhas, com "Ver completa" expandindo para tudo).
  - Badge "IA" se `smart_customization`, badge "Salva" se já houver `cadence_custom_messages` para a step 1.
  - Botões `Regenerar` e `Editar` (o "Editar" abre o `LeadMessagePreview` atual, que já permite editar/salvar todas as steps).

**Novo hook `useFirstStepPreviews(cadenceId, leadIds[])`** em `src/hooks/usePreviewCadenceMessages.ts`:
- Faz uma chamada batch à edge function `preview-cadence-messages` por lead (ou estende a função para aceitar `leadIds[]`).
- Retorna apenas a Step 1 (ou a primeira step ordenada por `step_order`).
- React Query com `staleTime` alto + cache por `(cadenceId, leadId)` para evitar regenerar a cada montagem.

**Mudança em `supabase/functions/preview-cadence-messages/index.ts`** (se necessário):
- Aceitar `leadIds: string[]` opcional e devolver `{ leadId, previews }` para cada um, em paralelo (limitado a ~5 concorrentes).
- Aceitar `onlyFirstStep: true` para reduzir custo (gera só step 1).

**Comportamento de custo**: a Step 1 só é gerada uma vez por (lead, cadência) e cacheada em `cadence_custom_messages` (já é o comportamento atual via `is_saved`). Leads novos disparam geração sob demanda quando a aba "Leads" é aberta.

---

## Fora do escopo
- Não mexer no fluxo de execução das cadências.
- Não alterar a UI de Steps, só a aba Leads.
- Não trocar o `LeadMessagePreview` existente — fica disponível via botão "Editar".

## Ordem de implementação
1. Edge function `preview-cadence-messages` → aceitar batch + `onlyFirstStep`.
2. Hook batch no front.
3. `CadenceDetail.tsx` → render inline da Step 1 nos cards de lead.
4. `LeadDetail.tsx` → auto-disparar análise do website quando faltar.
5. `enrich-lead/index.ts` → garantir análise quando `website` existir.
