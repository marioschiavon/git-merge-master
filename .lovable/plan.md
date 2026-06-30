# Configurar backend completo no novo Lovable Cloud

O Cloud foi ativado mas o banco está **vazio** (0 tabelas). O código tem 56 migrações e 60+ edge functions do projeto `outreach-ace-squad` que precisam ser aplicadas no novo Supabase deste projeto.

## Estado atual
- ✅ Lovable Cloud ativo (novo projeto Supabase: `plfcbbqzpcbgykfervnp`)
- ✅ 56 arquivos `.sql` em `supabase/migrations/`
- ✅ 60+ edge functions em `supabase/functions/`
- ❌ Nenhuma tabela criada no banco novo
- ❌ Nenhuma edge function deployada
- ❌ Secrets de integrações (Cal.com, Gmail, etc.) não configurados

## Passos

### 1. Aplicar schema (1 migração consolidada)
Concatenar os 56 arquivos `.sql` em ordem cronológica e rodar como **uma única migração** via `supabase--migration`. Isso cria todas as tabelas, RLS, policies, functions, triggers, enums e a infra de email (pgmq, cron).

> Será exibido um diff grande para aprovação — é esperado.

### 2. Deploy de todas as edge functions
Rodar `supabase--deploy_edge_functions` para todas as 60+ funções (`cadence-executor`, `calcom-*`, `gmail-*`, `process-email-queue`, webhooks etc.).

### 3. Auditar secrets necessários
Listar secrets atuais e identificar os que faltam para as integrações:
- **Cal.com**: `CALCOM_API_KEY`, `CALCOM_WEBHOOK_SECRET`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_BOOKING_LINK`
- **Email/Gmail**: avaliar se usa Lovable Emails (recomendado) ou Gmail API
- **Pipedrive / Twilio / Z-API**: conforme funções usadas
- **LOVABLE_API_KEY**: ✅ já existe

Pedir só os que forem realmente necessários via `add_secret` (após confirmação).

### 4. Configurar email infra
Rodar `email_domain--setup_email_infra` para ativar fila + cron de email (a migração `20260410002434_email_infra.sql` cria as tabelas mas a infra pgmq/cron precisa do tool).

### 5. Validação
- `security--run_security_scan` para RLS
- `supabase--linter` para warnings
- Conferir contagem de tabelas e cron jobs ativos

## Detalhes técnicos
- Não vou tocar em `src/integrations/supabase/client.ts`, `types.ts` ou `.env` (auto-gerados pelo Cloud).
- A consolidação preserva a ordem original dos timestamps das migrações.
- Se alguma migração depender de extensão não disponível (`pg_net`, `vault`, `pgmq`, `pg_cron`) o erro aparecerá no apply — corrijo na hora.
- Edge functions com `verify_jwt` custom (`*-webhook`, hooks) precisam de bloco em `supabase/config.toml` — verifico ao fazer deploy.

## Confirme antes de eu começar
1. Posso aplicar **tudo de uma vez** (1 migração consolidada de ~56 arquivos)?
2. Vamos manter **Lovable Emails** (recomendado) para os emails transacionais, ou você quer Gmail API via secret?
3. Quais integrações vamos ativar agora: **Cal.com**, **Pipedrive**, **Twilio**, **Z-API**? (posso ativar só as essenciais e adicionar o resto depois)
