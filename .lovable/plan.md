## Objetivo
Após o signup, o usuário deve entrar direto no app (já autenticado) e o `useAuth` o levará ao `/onboarding` automaticamente — sem pedir login manual.

## Mudanças

**`src/pages/Auth.tsx` — bloco `signUp` (linhas ~52-70):**

- Se `data.session` existir → `navigate("/")` (fluxo normal do `useAuth` redireciona para `/onboarding` se não houver empresa).
- Se `data.session` for `null` (auto-confirm desativado ou race condition) → fazer imediatamente `supabase.auth.signInWithPassword({ email, password })` com as credenciais recém-usadas e navegar para `/`. Só cair no fallback de "faça login" se esse signIn também falhar.
- Toast simplificado: "Conta criada!" em vez de "Você já pode fazer login."

## Fora de escopo
- Config de auth backend (já está com `auto_confirm_email = true`).
- Página `/onboarding` e lógica do `useAuth` (já redirecionam corretamente quando o usuário não tem empresa).
