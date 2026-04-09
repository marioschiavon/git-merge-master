

# Fase 2 — Integração Pipedrive (via API Token)

## Mudança principal
Em vez de OAuth (complexo), cada empresa informa seu **API Token pessoal** do Pipedrive nas configurações de integração. O token é armazenado de forma segura na tabela `integrations`.

---

## 1. Banco de Dados (Migration)

### Novas tabelas

**`integrations`** — conexões por empresa
- `id`, `company_id`, `provider` (enum: pipedrive), `api_token` (text, encrypted), `api_domain` (text), `status` (active/inactive/error), `last_synced_at`, `created_at`, `updated_at`
- RLS: company_admin pode gerenciar; membros podem ler; master_admin acesso total

**`leads`** — leads importados
- `id`, `company_id`, `pipedrive_id` (integer, unique per company), `name`, `email`, `phone`, `company_name`, `title`, `source`, `status` (enum: new/contacted/qualified/unqualified/converted), `score`, `pipedrive_data` (jsonb), `last_synced_at`, `created_at`, `updated_at`
- RLS: isolamento por `company_id`

**`lead_activities`** — timeline de interações
- `id`, `lead_id`, `company_id`, `type` (enum: email/call/whatsapp/linkedin/note/meeting), `description`, `metadata` (jsonb), `created_at`
- RLS: isolamento por `company_id`

---

## 2. Edge Functions (2 funções)

### `pipedrive-connect`
- POST: Recebe `api_token` + `company_id`, valida o token chamando `/users/me` na API do Pipedrive, e salva na tabela `integrations`
- Retorna status de conexão e nome do usuário Pipedrive

### `pipedrive-sync`
- POST: Busca leads da API do Pipedrive usando o token salvo
- Endpoints: `/persons` e `/deals` com paginação
- Faz upsert na tabela `leads` por `pipedrive_id`
- Atualiza `last_synced_at`

---

## 3. Frontend

### Integrations.tsx (atualizar)
- Card do Pipedrive com campo para colar o API Token
- Botão "Conectar" que valida e salva
- Status da conexão (Conectado/Desconectado)
- Botão "Sincronizar Agora" quando conectado

### Leads.tsx (reescrever)
- Tabela paginada com leads importados
- Filtros: status, busca por nome/email
- Badge de status com cores
- Botão "Sincronizar com Pipedrive"

### LeadDetail.tsx (novo)
- Drawer com dados completos do lead
- Timeline de atividades
- Dados do Pipedrive (jsonb formatado)

---

## 4. Hooks React Query
- `useIntegration(provider)` — busca integração da empresa
- `useLeads(filters)` — lista leads com filtros
- `useSyncLeads()` — mutation para sync manual
- `useConnectPipedrive()` — mutation para salvar token

---

## Ordem de execução
1. Criar migration (tabelas + RLS)
2. Criar edge functions (`pipedrive-connect`, `pipedrive-sync`)
3. Atualizar Integrations.tsx com formulário de token
4. Reescrever Leads.tsx com tabela real
5. Criar LeadDetail.tsx e hooks

