# Desativar confirmação por email

Ativar auto-confirm no auth do Lovable Cloud para que usuários fiquem logados imediatamente após o cadastro, sem precisar clicar em link.

## Alterações

1. **Config auth** — chamar `supabase--configure_auth` com:
   - `auto_confirm_email: true`
   - `password_hibp_enabled: true` (mantém proteção contra senhas vazadas — já está ativa)
   - `disable_signup: false`
   - `external_anonymous_users_enabled: false`

2. **Usuário existente** (`mario@s7.dev.br`) — está com `email_verified: false`. Vou confirmá-lo manualmente via update em `auth.users` para ele conseguir logar sem precisar do email.

## Fora de escopo

- Configurar domínio próprio de email (fica pra depois, se quiser voltar a exigir confirmação com boa deliverability).
- Alterar telas de signup/login no frontend — nada muda visualmente; o usuário só deixa de ser redirecionado pra "verifique seu email".

## Aviso de segurança

Auto-confirm = qualquer email digitado é aceito sem prova de posse. Ok pra MVP/testes internos. Antes de ir a produção com usuários externos, recomendo reativar confirmação + domínio próprio.
