# Isolamento Multi-Tenant Completo

Garantir que cada `company` só enxergue seus próprios dados (integrações, membros, leads, cadências, campanhas, conversas, etc.), tanto no banco (RLS) quanto no frontend (queries filtradas) e nas Edge Functions (autorização server-side).

## 1. Auditoria (antes de escrever SQL)

Rodar `supabase--read_query` para listar, em todas as tabelas de negócio, se existe coluna `company_id` e quais políticas RLS estão ativas hoje. Alvo mínimo:

- `integrations`, `gmail_account`, `calcom_event_types`, `calcom_webhook_log`
- `leads`, `lead_lists`, `lead_activities`, `lead_insights`, `lead_memory`, `lead_social_profiles`, `lead_enrichment_jobs`, `lead_action_queue`, `lead_intents_log`
- `cadences`, `cadence_steps`, `cadence_policies`, `cadence_enrollments`, `cadence_custom_messages`, `cadence_agent_decisions`
- `campaigns`, `conversations`, `messages`, `message_annotations`
- `bookings`, `slot_holds`, `slot_expiry_followups`, `calendar_actions`
- `company_knowledge`, `knowledge_chunks`, `script_templates`, `script_variations`
- `approval_requests`, `sdr_agent_runs`, `execution_logs`, `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`
- `intent_action_rules`, `pending_inbound_runs`, `processed_inbound_messages`
- `company_members`, `user_roles`

Saída da auditoria = matriz `tabela → tem company_id? → política atual`.

## 2. Migração de RLS uniforme

Para toda tabela de negócio com `company_id`, aplicar padrão único:

```sql
DROP POLICY IF EXISTS <antigas> ON public.<t>;

CREATE POLICY "tenant_select" ON public.<t> FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
      OR public.has_role(auth.uid(), 'master_admin'));

CREATE POLICY "tenant_write" ON public.<t> FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
      OR public.has_role(auth.uid(), 'master_admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid())
      OR public.has_role(auth.uid(), 'master_admin'));
```

Tabelas-filhas sem `company_id` (ex.: `messages`, `cadence_steps`, `knowledge_chunks`) usam política via join no pai:

```sql
USING (EXISTS (SELECT 1 FROM public.conversations c
  WHERE c.id = messages.conversation_id
    AND c.company_id = public.get_user_company_id(auth.uid())))
```

`company_members` e `user_roles`: usuário vê apenas linhas da própria empresa; `master_admin` vê tudo.

Confirmar `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` + `GRANT ALL ... TO service_role` em toda tabela tocada.

## 3. Frontend — filtro obrigatório por company

Criar helper `useCompanyId()` (já parcialmente em `useAuth`) e revisar todas as queries Supabase para incluir `.eq('company_id', companyId)` explicitamente (defesa em profundidade, mesmo com RLS). Arquivos alvo iniciais:

- `src/pages/settings/Integrations.tsx`, `Members.tsx`, `Knowledge.tsx`
- `src/pages/Leads.tsx`, `LeadLists.tsx`, `LeadDetail.tsx`
- `src/pages/Cadences.tsx`, `Campaigns.tsx`, `Inbox.tsx`, `Conversations.tsx`, `Bookings.tsx`, `Approvals.tsx`
- Componentes de listagem que fazem `.from(...).select()` sem filtro

Bloquear render quando `companyId` for `null` (loader) para evitar flash de dados vazios ou race conditions.

## 4. Edge Functions — autorização server-side

Estender `_shared/tenant-auth.ts` (criado antes) e aplicar em **todas** as funções que aceitam `company_id`, `lead_id`, `cadence_id`, `integration_id` no body: resolver o `company_id` real do recurso via service role e comparar com `requireCompanyMember(user, company_id)`. Nunca confiar no body.

Alvo prioritário (integrações e ações que escrevem):
- `gmail-*`, `calcom-*`, `pipedrive-*`, `apollo-*`, `apify-*`
- `launch-campaign`, `enroll-cadence`, `send-message`, `enrich-lead`, `webhook-*`
- Qualquer função invocada pelo cliente com `supabase.functions.invoke`

## 5. Members por empresa

Página `settings/Members.tsx`: listar apenas `company_members` da empresa atual, permitir convidar/remover (respeitando `company_admin`/`master_admin`). Invite via edge function que valida papel do chamador.

## 6. UX

- Empty states claros ("Nenhuma integração conectada para {companyName}")
- Badge da empresa já no sidebar → adicionar tooltip com role
- Se `master_admin` → seletor de empresa (switch tenant) no header (opcional, marcar como fase 2)

## 7. Validação

- Criar 2ª empresa de teste + usuário B → confirmar que A não vê nada de B em: integrações, leads, cadências, conversas, members
- Rodar `supabase--linter` após as migrações
- Playwright: login como B, tentar `GET /rest/v1/leads?company_id=eq.<A>` → deve retornar `[]`

## Detalhes técnicos

- Uma migração por grupo lógico (RLS integrações, RLS leads, RLS cadências, RLS conversas, RLS knowledge, RLS logs) para facilitar revisão
- Preservar policies existentes de `master_admin` já corretas
- Nenhuma mudança em `auth.*`, `storage.*`
- Zero breaking changes esperados no frontend além de adicionar filtros e loaders

## Fora do escopo

- Trocar de tenant em runtime (fase 2)
- Billing por empresa
- Convites por email com token (usar apenas add manual de member por enquanto)
