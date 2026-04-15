

## Corrigir fluxo de redefinição de senha

### Problema
O `redirectTo` aponta para `/auth`, que é a tela de login. Quando o usuário clica no link do email, o Supabase faz login automático com uma sessão de recovery — mas a página `/auth` não detecta isso e mostra o login normal.

### Solução

1. **Criar página `/reset-password`** (`src/pages/ResetPassword.tsx`)
   - Formulário com "Nova senha" e "Confirmar senha"
   - No `useEffect`, escutar `onAuthStateChange` para o evento `PASSWORD_RECOVERY`
   - Ao submeter, chamar `supabase.auth.updateUser({ password })`
   - Após sucesso, redirecionar para `/dashboard`

2. **Adicionar rota no `App.tsx`**
   - Rota pública: `<Route path="/reset-password" element={<ResetPassword />} />`

3. **Corrigir `redirectTo` no `Auth.tsx`**
   - Mudar de `${window.location.origin}/auth` para `${window.location.origin}/reset-password`

### Arquivos
- `src/pages/ResetPassword.tsx` (novo)
- `src/pages/Auth.tsx` (1 linha)
- `src/App.tsx` (2 linhas: import + rota)

