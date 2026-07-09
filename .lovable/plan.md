
## Objetivo

Substituir o placeholder de `/settings/team` por uma tela funcional que faz **o que dá para fazer sem depender de integrações**: listar membros da empresa, trocar papel e remover.

O fluxo de **convite por email** fica postergado — é um capítulo natural depois de [03b. Email (domínio próprio)](../docs/manual/03b-email-resend.md) estar configurado. Quando chegar lá, entra numa iteração futura.

## 1. RPC `list_company_members`

Necessário porque o email do usuário mora em `auth.users` e não pode ser lido direto do frontend.

Nova função SECURITY DEFINER `public.list_company_members(_company_id uuid)` retornando:

- `user_id uuid`
- `email text`
- `full_name text`
- `phone text`
- `role app_role`
- `joined_at timestamptz`

Autoriza se `auth.uid()` for membro da mesma empresa ou master_admin. Faz join `company_members` + `profiles` + `auth.users`.

## 2. RPC `remove_company_member(_user_id uuid)`

SECURITY DEFINER. Regras:

- Só company_admin da empresa do alvo (ou master_admin) pode chamar.
- Não pode remover a si mesmo.
- Não pode remover o **último** company_admin (impede ficar sem admin).
- Deleta linha de `company_members` e a role correspondente em `user_roles`.

## 3. RPC `update_company_member_role(_user_id uuid, _new_role app_role)`

SECURITY DEFINER. Regras:

- `_new_role` só pode ser `company_admin` ou `user` (nunca `master_admin`).
- Só company_admin/master_admin pode chamar.
- Não pode rebaixar a si mesmo se for o último company_admin.
- Atualiza `company_members.role` e reflete em `user_roles` (remove role antiga, insere nova).

## 4. Frontend `src/pages/settings/Team.tsx`

Reescrever:

- Header com título e subtítulo.
- Card **Membros** com tabela: Nome, Email, Telefone, Papel, Entrou em, Ações.
  - Papel: `Select` inline (opções: **Admin da empresa** / **Usuário**) — desabilitado se o alvo é o próprio usuário ou se é `master_admin`.
  - Ações: botão **Remover** com `AlertDialog` de confirmação. Escondido para si mesmo e para master_admin.
- Alerta informativo no topo (`Alert` do shadcn) explicando: _"Novos membros ainda são adicionados manualmente pela equipe Leaderei. Em breve você poderá convidar por email direto daqui."_

Master_admin aparece na lista como badge "Suporte Leaderei" e não é gerenciável.

## 5. Hook `src/hooks/useTeam.ts`

- `useTeamMembers(companyId)` → `supabase.rpc('list_company_members', { _company_id })`.
- `useUpdateMemberRole()` → chama RPC 3, invalida query.
- `useRemoveMember()` → chama RPC 2, invalida query.

Toasts em sucesso/erro.

## 6. Manual `docs/manual/02-equipe.md`

Atualizar para refletir a realidade:

- Explicar papéis (mantém o que já está).
- Trocar "Passo a passo" de convite por: **"Enquanto o convite por email não está disponível, peça à equipe Leaderei para adicionar o novo membro. Depois de adicionado, você pode ajustar o papel e remover pela tela Equipe."**
- Nova seção **Gerenciar membros existentes** com o passo a passo real da tela (mudar papel, remover, regra do "último admin").
- Nota no final: _"Convite por email será liberado após você configurar Email (03b) ou WhatsApp (03a)."_

## Fora de escopo

- Sem tabela `company_invites`, sem edge function de envio, sem template de email.
- Sem alteração em `src/pages/Auth.tsx`.
- Sem mexer em Supabase Auth settings.

## Detalhes técnicos

- Todos os textos em português.
- Confirmação obrigatória em remover.
- Se a lista tiver só 1 membro, ainda renderiza a tabela (mostra o próprio usuário) — útil para ver o próprio papel.
