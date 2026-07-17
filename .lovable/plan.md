# Enriquecimento automático em fila, com progresso visível

## Diagnóstico

O sistema já tem toda a infraestrutura: tabela `lead_enrichment_jobs`, trigger `enqueue_lead_enrichment` que enfileira ao inserir um lead, edge function `enrichment-cron` que puxa jobs `pending` e chama `enrich-lead`. Faltam **duas coisas**:

1. **`enrichment-cron` nunca é agendada.** Hoje só existem no `cron.job` os schedules `sdr-debounce-tick` e `cadence-reengage-cron`. Nada aciona o cron de enriquecimento, então a fila só anda quando o usuário abre um lead (o `LeadSocialCard` chama `enrich-lead` direto). É por isso que "só começa a enriquecer quando clica no lead".
2. **`apollo-import` (com `enrich_limit`) segura leads em `not_queued`.** Precisa de um botão manual "Enriquecer mais N" para liberar. Isso reforça o comportamento de ter que agir lead a lead.

## Plano

### 1. Agendar `enrichment-cron` a cada minuto (via `supabase--insert`)
Criar `cron.schedule('enrichment-cron','* * * * *', … net.http_post → /functions/v1/enrichment-cron)`. Como contém URL + anon key específicas do projeto, entra pelo `supabase--insert`, não migration (conforme regra do projeto).

### 2. Aumentar vazão da fila
Em `supabase/functions/enrichment-cron/index.ts`:
- Subir `limit(5)` → `limit(10)`.
- Disparar as invocações de `enrich-lead` em paralelo (`Promise.allSettled`) mantendo o timeout individual — a fila continua consumindo "um após o outro por lead", mas o cron passa a processar um lote decente por minuto.

### 3. Enfileirar todos por padrão em importações
Em `supabase/functions/apollo-import/index.ts`:
- Remover o corte automático em `not_queued`. Só marcar como `not_queued` se o cliente passar `enrich_limit` explicitamente (mantém compat).
- Sem `enrich_limit`, todos os 100 leads da importação entram como `pending` e o cron drena naturalmente.
- Conferir que `LeadImportDialog` (CSV) e `leads-bulk-action` não passam `enrich_limit` — hoje já não passam.

### 4. Badge de progresso em `/leads` (o pedido do usuário)
Em `src/pages/Leads.tsx`, adicionar um `EnrichmentQueueBadge` no topo da lista:

- Novo hook `useEnrichmentQueueStatus(companyId)` que consulta a cada 10s:
  ```
  SELECT enrichment_status, count(*)
  FROM leads WHERE company_id = :cid
  GROUP BY enrichment_status
  ```
- Deriva `{ pending, processing, completed, failed, total }`.
- Renderização:
  - Se `pending + processing > 0`:
    Ícone spinner + "Enriquecendo leads… **X de Y prontos**" (progresso `completed / (completed+pending+processing)`), com uma barra fina.
  - Se `pending + processing === 0` e `total > 0`:
    Ícone check verde + "Todos os leads enriquecidos" (auto-esconde após 30s ou até nova importação).
  - Se `failed > 0`, sub-linha discreta: "N falharam — reprocessar" (link para filtro `failed`).
- Realtime opcional: `supabase.channel('leads-enrichment').on('postgres_changes', {event:'UPDATE', table:'leads', filter:'company_id=eq…'})` para atualizar mais rápido sem polling agressivo.

### 5. Feedback pós-import
No toast de sucesso das telas de importação (Apollo, CSV, bulk), trocar mensagem para: *"N leads importados. Enriquecimento em andamento — acompanhe no topo da tela."* Isso educa o usuário a olhar o badge em vez de clicar em cada lead.

## Diagrama do fluxo pós-mudança

```text
Importar (Apollo/CSV/bulk)
        │
        ▼
INSERT leads (pending)  ──trigger──▶ lead_enrichment_jobs (pending)
                                             │
                     pg_cron * * * * * ──────┘
                                             ▼
                                    enrichment-cron
                                    (10 jobs em paralelo)
                                             │
                                             ▼
                                    enrich-lead × N
                                             │
Badge /leads ◀── polling 10s + realtime ─────┘
   "Enriquecendo X de Y" → "Todos prontos ✓"
```

## Arquivos afetados

- `supabase/functions/enrichment-cron/index.ts` — limit=10 + paralelismo
- `supabase/functions/apollo-import/index.ts` — default enfileira tudo
- `src/hooks/useEnrichmentQueueStatus.ts` — novo
- `src/components/EnrichmentQueueBadge.tsx` — novo
- `src/pages/Leads.tsx` — inclui o badge no topo
- `supabase--insert` para criar o `cron.schedule` do `enrichment-cron`

## Não escopo

- Não altero schema (nenhuma migration).
- Não mexo em `enrich-lead` (pipeline atual de enriquecimento fica igual).
- `enrichment-enqueue-more` continua existindo para casos onde o admin ainda quiser segurar volume via `enrich_limit`.
