
## Objetivo

Facilitar login/cadastro em `src/pages/Auth.tsx`:
1. Botão **revelar/ocultar senha** (ícone olho) no campo de senha, tanto no login quanto no cadastro.
2. Campo **Confirmar senha** apenas no cadastro, com validação de que as duas senhas coincidem antes de submeter.
3. Ícone olho também no campo Confirmar senha.

## Mudanças

- **`src/pages/Auth.tsx`**:
  - Novos estados: `showPassword`, `showConfirmPassword`, `confirmPassword`.
  - Envolver o `Input` da senha em um wrapper `relative` com um `<button type="button">` posicionado à direita usando ícones `Eye` / `EyeOff` do `lucide-react`. Alterna `type` entre `password` e `text`.
  - No cadastro (`!isLogin`), adicionar bloco "Confirmar senha" com mesmo padrão (input + toggle).
  - No `handleSubmit`, quando `!isLogin`: se `password !== confirmPassword`, exibir `toast.error("As senhas não coincidem.")` e abortar.
  - Ao alternar entre login/cadastro (`setIsLogin`), limpar `confirmPassword` e resetar os toggles de visibilidade.

## Fora de escopo

- Não altera fluxo de OAuth, esqueci-senha, ou redirects.
- Não muda regras de força de senha além do `minLength=6` já existente.
- Sem mudanças de backend.

## Validação

- No login: campo de senha mostra ícone olho; clicar alterna visibilidade; submit continua funcionando.
- No cadastro: aparecem dois campos (Senha + Confirmar senha) com toggle cada; senhas diferentes mostram toast e não submetem; senhas iguais criam a conta normalmente.
