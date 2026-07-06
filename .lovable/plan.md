## Diagnóstico

Renan B. tem `lead_insights` completo (proposta_valor + resumo) → detalhe mostra "Pronto" corretamente. Na lista, porém, aparece "Revisar" porque `useLeadInsightsBatch` faz `.in('lead_id', [671 UUIDs])`, gerando uma URL de ~25 KB que o PostgREST rejeita silenciosamente. Resultado: `insightsMap` fica `{}` e todo lead sem match cai em `needs_review` ("Revisar").

Confirmado no banco:
- 671 leads no total, 5 rows em `lead_insights`.
- RLS de `lead_insights` já restringe por `company_id` (policy `Company members can manage lead_insights`).

## Correção

Trocar o filtro `.in('lead_id', leadIds)` por um SELECT sem filtro em `useLeadInsightsBatch` — a RLS já garante que só voltam insights da company do usuário. Como a tabela é pequena por tenant (unique em `lead_id`, hoje 5 rows), isso é mais barato do que 671 IDs na URL e resolve o bug para qualquer tamanho de lista.

### Mudanças

**`src/hooks/useLeadInsights.ts`** — em `useLeadInsightsBatch`:
- Remover o parâmetro `leadIds` do filtro da query (mantém na assinatura só para saber quando habilitar / invalidar).
- Query passa a ser `select('lead_id, insights, raw_summary, analyzed_at').order('analyzed_at', { ascending: false })`, sem `.in(...)`.
- `queryKey` vira algo estável tipo `["lead_insights_batch", "all"]` (RLS cuida do escopo por company). Assim a lista inteira compartilha um único cache e não refaz fetch quando `leadIds` muda.
- Continua construindo o `map` pegando a row mais recente por `lead_id`.

**Nada mais muda** — `Leads.tsx`, `lead-readiness.ts` e `LeadDetailContent.tsx` continuam iguais. A assinatura pública do hook fica compatível.

## Validação

1. Recarregar `/leads` e conferir que Renan B. mostra "Pronto" na lista (igual ao detalhe).
2. Conferir que Thiago/Adilson continuam como "Revisar".
3. Abrir Network e confirmar que a request para `lead_insights` não tem mais a lista gigante de IDs na URL.
