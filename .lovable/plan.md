# Plano Multi-Tenant Completo

Objetivo: fechar as lacunas de multi-tenancy identificadas na auditoria, com onboarding, autorização segura em edge functions e bootstrap do usuário `mario@s7.dev.br` como master_admin da empresa S7.

## 1. Bootstrap imediato (dados)

Via `supabase--insert` (um único bloco SQL):

- `INSERT INTO public.companies (name, slug, status)` → `('S7', 's7', 'active')`.
- `INSERT INTO public.company_members (user_id, company_id, role)` vinculando `mario@s7.dev.br` como `admin`.
- `INSERT INTO public.user_roles (user_id, role)` com `'master_admin'` (idempotente).

## 2. Onboarding de novos usuários

- Nova página `src/pages/Onboarding.tsx`: formulário simples (nome da empresa) exibido quando o usuário logado não tem registro em `company_members`.
- RPC `create_company_and_join(p_name text, p_slug text)` (SECURITY DEFINER):
  - Cria `companies`, insere `company_members` (role `admin`) e `user_roles` (`company_admin`) usando `auth.uid()`.
  - Retorna o `company_id`.
- Guard em `src/App.tsx` (ou hook `useAuth`): se autenticado e `companyId` nulo, redireciona para `/onboarding`.

## 3. Autorização server-side nas Edge Functions

- Novo helper compartilhado `supabase/functions/_shared/tenant-auth.ts`:
  - `requireUser(req)` → valida JWT via `getClaims`.
  - `requireCompanyMember(userId, companyId)` → consulta `company_members`; 403 se não pertencer.
  - `requireRole(userId, role)` → usa `has_role()`.
- Refatorar as edge functions críticas que hoje confiam no `company_id` do cliente (integrações Pipedrive, Gmail, Cal.com, Z-API, cadences, enrichment) para chamar esses helpers antes de qualquer operação.

## 4. UI mínima de tenant

- Badge com nome da empresa atual no `AppSidebar` (usando `companyId` do `useAuth` + query em `companies`).
- Sem seletor de troca de tenant nesta iteração (usuário único por empresa hoje).

## 5. Verificação

- `tsgo` para checar tipos após mudanças.
- Login manual com `mario@s7.dev.br` para confirmar que o app carrega com `companyId` da S7 e não cai no onboarding.
- Teste rápido de uma edge function (ex.: Pipedrive) enviando `company_id` de outra empresa → deve retornar 403.

## Fora de escopo

- Convite de novos membros à empresa.
- Troca de tenant no header.
- Billing por tenant.

## Detalhes técnicos

- RPC em migration nova (schema change) → `supabase--migration`.
- Bootstrap da S7 em `supabase--insert` (dados).
- Helper de auth em Deno/TypeScript reutilizando `SUPABASE_URL` + `SUPABASE_ANON_KEY` já existentes.
- Após o bootstrap, você precisa deslogar/logar uma vez para o `useAuth` recarregar o `companyId`.
