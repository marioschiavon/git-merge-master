# Corrigir redirecionamento pós-login

## Problema

Ao clicar em "Entrar", o token é emitido com sucesso (HTTP 200), mas o usuário permanece na tela `/auth` com o botão travado em "Carregando..." e nenhuma navegação para `/dashboard` acontece.

## Causa

Em `src/hooks/useAuth.tsx`, o callback do `supabase.auth.onAuthStateChange` faz `await fetchUserData(...)`, e `fetchUserData` executa `supabase.from(...)` (roles, company_members, profiles, companies). Isso é o deadlock clássico do supabase-js: chamadas ao cliente Supabase dentro do callback de `onAuthStateChange` bloqueiam o próprio pipeline de auth, então:

- `setLoading(false)` no callback nunca é atingido de forma consistente.
- `Auth.tsx` chama `navigate("/")` mas o `AuthProvider` fica em estado inconsistente.
- O usuário fica preso em `/auth`.

Isso está confirmado por:
- Network log mostra apenas o `token?grant_type=password` no momento do clique (21:26:44); as queries de `user_roles`, `profiles`, `company_members`, `companies` só aparecem quase 20 min depois, quando o usuário navegou manualmente e recarregou.
- Session replay mostra o botão "Carregando..." permanente após o clique.

## Correção

Editar `src/hooks/useAuth.tsx`:

1. Manter o listener `onAuthStateChange` **síncrono**: apenas atualiza `session` e `user` no state e faz `setLoading(false)`. Sem `await` de nada do Supabase dentro do callback.
2. Disparar `fetchUserData` de forma "fire-and-forget" (via `setTimeout(0)` ou apenas chamando sem `await`) para carregar roles/profile/companyId **fora** do callback de auth.
3. No `getSession()` inicial, seguir o mesmo padrão: setar `session`/`user`/`loading=false` primeiro, e disparar `fetchUserData` fora do await do auth.
4. Manter a lógica atual de checagem de `companies.status === "inactive"` (com `signOut`), mas executada dentro de `fetchUserData` que agora roda desacoplada.
5. Preservar comparações "estáveis" já existentes (evitar re-render desnecessário) e o `useMemo` do value.

Nenhuma mudança em `Auth.tsx`, `AppLayout.tsx`, rotas, backend ou banco.

## Fora do escopo

- Não alterar edge functions, migrations, tipos, ou qualquer outra tela.
- Não mudar o design da tela de login.
- Não mexer no fluxo de onboarding/master admin — apenas destravar o `loading` para que a navegação atual funcione.

## Validação

Após a mudança, ao fazer login com um usuário `company_admin` com empresa ativa:
- Botão sai de "Carregando..." rapidamente.
- Navegação para `/dashboard` ocorre.
- Não há loop de redirecionamento para `/auth` ou `/onboarding`.
