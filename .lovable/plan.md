## Objetivo

Permitir que **Admin da empresa** gere um **link de convite** copiável na tela Equipe. O convidado abre o link, vê a empresa e o papel pré-definidos, preenche **nome, email e senha**, cria a conta e é automaticamente vinculado à empresa com o papel certo. Sem depender de Email (03b) ou WhatsApp (03a) — o admin compartilha o link pelo canal que preferir.

Quando as integrações de envio estiverem prontas, dá para plugar o disparo automático por cima desse mesmo fluxo — fica para depois.

## Fluxo do usuário

1. Admin abre **Configurações → Equipe**, clica em **Convidar membro**.
2. Modal pede só o **papel** (Admin da empresa / Usuário). Sem email — o convite é um link genérico da empresa+papel.
3. Ao confirmar, o sistema cria o convite e mostra **link + botão Copiar**. O link também fica em **Convites pendentes** (Copiar / Cancelar).
4. Convidado abre `https://app.leaderei.com.br/invite/<token>`:
   - Página pública valida o token via RPC.
   - Mostra: **"Você foi convidado para <Empresa> como <Papel>"**.
   - Formulário: **nome completo, email, senha, confirmação de senha** (todos editáveis — o email é o que ele vai usar para login).
   - Submit: cria conta no Auth, chama RPC de aceite, mostra tela de sucesso com botão **Ir para login**.
5. Estados de erro tratados: token inválido, expirado (>7 dias), já usado, cancelado.

## 1. Migração — tabela `company_invites`

Colunas de domínio:

- `company_id` (FK companies)
- `role` (`app_role`, restrito a `company_admin` / `user`)
- `token` (uuid único, gerado pelo servidor)
- `invited_by` (FK auth.users)
- `expires_at` (default `now() + 7 days`)
- `accepted_at`, `accepted_by`, `cancelled_at`

GRANTs padrão (`authenticated` + `service_role`) + RLS: SELECT/INSERT/UPDATE/DELETE só para company_admin da própria empresa ou master_admin. Sem `anon`. A página pública NÃO lê direto — usa RPC SECURITY DEFINER.

## 2. RPCs (SECURITY DEFINER)

**`get_invite_by_token(_token text)`** — retorna `company_name, role, status` (pending / expired / accepted / cancelled / not_found). Executável por `anon` (é o que a página pública precisa).

**`create_company_invite(_role app_role)`** — valida caller = company_admin/master_admin, rejeita `master_admin` como role, cria linha com token novo, retorna `{ token, expires_at }`.

**`cancel_company_invite(_invite_id uuid)`** — só admin da mesma empresa, marca `cancelled_at`.

**`accept_company_invite(_token text, _user_id uuid)`** — chamada logo após signup. Valida token pendente + não expirado. Insere em `company_members` + `user_roles` (`on conflict do nothing`), marca `accepted_at`/`accepted_by`. Retorna `company_id`. Executável por `authenticated`.

## 3. Frontend

**Nova rota pública** `/invite/:token` → `src/pages/InviteAccept.tsx`:

- `get_invite_by_token` no mount → renderiza loading / inválido / expirado / cancelado / já aceito / pending.
- Form com validação zod: `full_name` (trim, 2-100), `email` (trim, email, ≤255), `password` (≥6), `confirm` (===password).
- Submit: `supabase.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: `${origin}/auth` } })` → pega `data.user.id` → `supabase.rpc('accept_company_invite', { _token, _user_id })` → tela de sucesso com **Ir para login** (`/auth`).
- Se auto-confirm de email estiver desligado no Auth, o accept ainda roda usando o `user.id` retornado; o usuário confirma o email e depois faz login.

**Atualizar `src/pages/settings/Team.tsx`:**

- Botão **Convidar membro** → Dialog só com Select de papel.
- Após criar: exibe o link com **Copiar** (`navigator.clipboard`).
- Novo card **Convites pendentes** abaixo de Membros: Papel, Criado em, Expira em, Ações (Copiar link, Cancelar com AlertDialog).

**Atualizar `src/hooks/useTeam.ts`:** `usePendingInvites`, `useCreateInvite`, `useCancelInvite`.

**Registrar rota `/invite/:token` em `src/App.tsx`** como rota pública (fora do `AppLayout`, ao lado de `/auth` e `/reset-password`).

## 4. Manual

Atualizar `docs/manual/02-equipe.md`:

- Substituir a nota "convite por email ainda não disponível" por seção **Convidar novo membro**: gerar link → copiar → enviar pelo canal que preferir → convidado se cadastra sozinho (nome/email/senha).
- Adicionar **Convites pendentes** (copiar de novo, cancelar, validade de 7 dias).
- Nota final: _"O envio automático por email/WhatsApp entra depois que você configurar 03a/03b."_

## Fora de escopo

- Envio automático do link por email/WhatsApp (encaixa depois sobre o mesmo `create_company_invite`).
- Reenviar convite (por enquanto: cancelar + criar novo).
- Verificação de domínio corporativo do email.
- Múltiplas empresas por usuário.

## Detalhes técnicos

- Textos em português.
- Token = `gen_random_uuid()::text` (36 chars, sem PII).
- Rota `/invite/:token` **pública**, não passa por `RequireAuth`.
- `accept_company_invite` roda SECURITY DEFINER porque grava em `company_members`/`user_roles` fora do escopo RLS do usuário recém-criado.
- Signup usa `emailRedirectTo: ${window.location.origin}/auth`.
- Se o token já foi aceito ou está expirado, a página bloqueia o cadastro com mensagem clara e link para `/auth`.
