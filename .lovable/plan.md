
# Integração Apollo.io — porte do Leaderei Foundation

Objetivo: replicar aqui a mesma integração Apollo que já roda no **Leaderei Foundation** (busca de prospects + importação direta pra base + enriquecimento de lead + telemetria de créditos), adaptada ao schema/stack deste projeto (`companies` + edge functions Supabase, não `organizations` + TanStack Start).

## O que existe hoje no Foundation (referência)

- `apollo_api_calls` — log de toda chamada à API (endpoint, status, créditos, latência, erro). Serve pra telemetria e rate-limit local de 30 req/min.
- `apollo_search_cache` — cache 24h de resultados de busca (chaveado por hash dos filtros + página).
- Coluna `leads.apollo_person_id` + índice único parcial `(org, apollo_person_id)`.
- Credencial salva em `integration_credentials` (chave `api_key`, valor cru — Foundation encripta via outra camada). Aqui vamos usar a mesma tabela `integrations` que o Pipedrive já usa.
- Client Apollo em `apollo.server.ts` com: `callApollo`, `validateApolloKey` (endpoint `auth/health`), `searchPeopleWithCache` (`mixed_people/api_search`), `mapPersonToLeadPayload`, `mergeLeadPatch`, `enrichLeadWithApollo` (`people/match`).
- UI: dialog de conectar/desconectar em Integrações + página dedicada `/dashboard/leads/apollo` com filtros (keywords, cargos, senioridade, localização, indústria, tamanho de empresa) e importação em lote com dedup por `apollo_person_id` → `email` → `linkedin_url`.

## Plano de implementação neste projeto

### 1. Migração de banco

Uma migração nova com:

- `public.apollo_api_calls` — mesmas colunas, mas `company_id uuid references companies(id)`.
- `public.apollo_search_cache` — idem, `company_id`, `unique (company_id, query_hash, page)`.
- `alter table public.leads add column if not exists apollo_person_id text` + índice único parcial `(company_id, apollo_person_id)`.
- GRANTs completos (`authenticated` + `service_role`) e RLS por `get_user_company_id(auth.uid()) = company_id` para SELECT/INSERT/UPDATE/DELETE; `master_admin` via `has_role`.
- Sem alterar `integrations` — Apollo entra como novo `provider = 'apollo'` na tabela existente, mesmo padrão do Pipedrive. A `api_key` do usuário fica em `integrations.metadata->>'api_key'` (mesmo modelo que o app já usa; sem tabela `integration_credentials`).

### 2. Edge functions (Supabase)

- `_shared/apollo.ts` — helper: `callApollo`, `validateApolloKey`, `normalizeFilters`, `hashFilters`, `searchPeopleWithCache`, `mapPersonToLeadPayload`, `mergeLeadPatch`. Rate-limit 30/min via count em `apollo_api_calls`. Timeout 15s. Erros humanizados (401/403 chave inválida, 429, 5xx).
- `apollo-connect` — valida chave (`GET auth/health`), grava `integrations` (`provider='apollo'`, `status='active'`, `metadata: { api_key }`).
- `apollo-disconnect` — set `status='inactive'`, remove `api_key` do metadata.
- `apollo-status` — retorna `{ connected, has_key, last_check_at, last_error }`.
- `apollo-search` — recebe `{ filters, page }`, roda `searchPeopleWithCache`, devolve `people + pagination + fromCache + existingEmails + existingApolloIds` (dedup hints por `leads` da company).
- `apollo-import` — recebe `people[]` (payload retornado pela busca), mapeia via `mapPersonToLeadPayload`, dedup em 3 níveis (`apollo_person_id` → `email` → `linkedin_url`), insere ou faz merge não-destrutivo. Retorna `{ created, updated, skipped }`.
- `apollo-enrich-lead` — recebe `lead_id`, monta body pra `people/match` a partir de email/linkedin/nome+empresa/domínio, aplica `mergeLeadPatch`.

Todas usam JWT do request → resolve `company_id` via `get_user_company_id(auth.uid())`; `master_admin` pode passar `company_id` explícito.

### 3. Front-end (Vite + React)

- `src/hooks/useApollo.ts` — hooks `useApolloStatus`, `useConnectApollo`, `useDisconnectApollo`, `useApolloSearch`, `useApolloImport`, `useApolloEnrichLead`. Mesmo padrão do `usePipedrive.ts`.
- `src/components/ApolloConnectDialog.tsx` — porte direto do dialog do Foundation, ajustado pros hooks acima e pra tokens de design daqui.
- `src/pages/settings/Integrations.tsx` — adicionar card "Apollo.io" ao lado do Pipedrive, botões Conectar/Desconectar/Abrir busca.
- `src/pages/ApolloSearch.tsx` — porte de `_app.dashboard.leads.apollo.tsx` (filtros, tabela de resultados, seleção múltipla, importação em lote, paginação limitada a 5 páginas).
- `src/App.tsx` + `src/components/AppSidebar.tsx` — nova rota `/apollo` (item "Buscar no Apollo" no menu Leads/Ferramentas).
- Opcional (fase 2): botão "Enriquecer com Apollo" no `LeadDetail.tsx` chamando `apollo-enrich-lead`.

### 4. Requisitos & configuração

- **Segredo necessário**: nenhum global. A chave Apollo é por empresa e vem do usuário via UI (armazenada em `integrations.metadata.api_key`). Cada `company_admin` conecta a própria chave.
- Sem novo connector Lovable — Apollo não é gateway-enabled; falamos direto com `api.apollo.io/api/v1` da edge function usando a chave da empresa.
- Rate-limit local (30/min) protege créditos; cache 24h evita cobrança dupla em buscas repetidas.

### 5. Detalhes técnicos

- **Endpoints Apollo usados**: `auth/health` (validação), `mixed_people/api_search` (busca), `people/match` (enriquecimento).
- **Header de auth**: `X-Api-Key: <chave>`.
- **Créditos**: Apollo devolve `x-credits-consumed` em alguns responses; salvo em `apollo_api_calls.credits_consumed` pra futuros relatórios.
- **Dedup**: 3 níveis, sempre não-destrutivo (`mergeLeadPatch` só preenche campos vazios). `enrichment_data.apollo` sempre substituído pelo payload mais recente.
- **Limite de páginas**: máx. 5 páginas por busca (proteção de créditos, igual ao Foundation).
- **RLS**: todas as tabelas Apollo escopadas por `company_id` via `get_user_company_id`; master_admin com acesso total via `has_role`.

### 6. Fora de escopo desta rodada

- Cron de re-enriquecimento automático em massa.
- UI de telemetria/consumo de créditos (dados ficam gravados; dashboard depois).
- Sync bidirecional Apollo ↔ leads (só importação/enriquecimento manual).
