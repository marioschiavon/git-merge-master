## Verificação completa do banco de dados

Vou executar uma auditoria em 4 frentes, todas em paralelo, e devolver um relatório único com status (OK / atenção / problema) por item.

### 1. Migrações aplicadas
- Listar as 56 migrações em `supabase/migrations/` e comparar com o estado real do Supabase (tabelas, colunas, índices, funções, triggers).
- Identificar migrações com falha, drift (schema real ≠ SQL) ou objetos esperados que não existem.

### 2. Conexão e secrets
- Conferir `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID = pqrslnydcrpjelpzdnyp`) e `supabase/config.toml` apontando pro mesmo projeto.
- Rodar `fetch_secrets` e cruzar com os secrets que as edge functions consomem (`CALCOM_WEBHOOK_SECRET`, `LOVABLE_API_KEY`, tokens Twilio/Z-API/Pipedrive, etc.) — listar o que falta.
- Validar que `supabase/functions/*/index.ts` não referencia env var inexistente.

### 3. RLS e policies
- Rodar `security--run_security_scan` para detectar tabelas em `public` sem RLS, policies permissivas demais (`USING (true)`), grants faltando, funções `SECURITY DEFINER` sem `search_path`.
- Validar padrão de `user_roles` + `has_role()` (sem recursão).
- Conferir que toda tabela nova tem o bloco `GRANT … TO authenticated/service_role` exigido pelo PostgREST.

### 4. Dados e integridade
- Contagens das tabelas-chave: `companies`, `leads`, `conversations`, `bookings`, `messages`, `lead_action_queue`, `calcom_webhook_log`.
- FKs órfãs (ex.: `bookings.lead_id` apontando pra lead inexistente, `messages.conversation_id` sem conversa).
- Filas travadas: itens em `lead_action_queue` com `status='pending'` há muito tempo; `calcom_webhook_log` com `processed=false` ou `error not null`.
- Holds expirados não limpos (`slot_holds`).

### Pré-requisito técnico
A sessão atual está sem `psql` direto (`PGHOST` vazio). Para itens 1, 3 e 4 vou usar `security--run_security_scan` + leitura via tools do Supabase. Para queries de contagem/integridade preciso que você habilite, em **Lovable Cloud → Settings**, o "Always allow" para **Read database** (e opcionalmente **Add data** se eu precisar inserir um registro de teste). Sem isso eu consigo só auditar schema e RLS, não os dados.

### Entregável
Um único relatório no chat:
```
[OK]      Migrações: 56/56, sem drift
[ATENÇÃO] Secrets: CALCOM_WEBHOOK_SECRET ausente em prod
[PROBLEMA] RLS: tabela X sem policy de SELECT
[OK]      Integridade: 0 FKs órfãs
```
Sem alterações de código nem de schema nesta etapa — só leitura. Se algum problema aparecer, abro um plano separado pra corrigir.