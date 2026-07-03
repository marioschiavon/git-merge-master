## Objetivo

Garantir que novos usuários entrem direto no app após o cadastro, sem precisar confirmar o email.

## Diagnóstico

O log de autenticação mostra `immediate_login_after_signup: true`, o que indica que o auto-confirm parece estar ativo em algum ponto. Mesmo assim, você percebe que a confirmação continua acontecendo — provavelmente o email de confirmação ainda é disparado, ou a configuração de auth do backend não está persistida como esperado.

## O que fazer

1. Reaplicar a configuração de auth do backend com:
   - `auto_confirm_email = true` (usuário é confirmado automaticamente ao se cadastrar)
   - `disable_signup = false` (mantém cadastro aberto)
   - `external_anonymous_users_enabled = false` (mantém logins anônimos desligados)
   - `password_hibp_enabled = false` (mantém o comportamento atual)

2. Validar criando um novo usuário de teste:
   - Não deve chegar email de "confirme seu email"
   - O usuário deve conseguir logar imediatamente após o cadastro

## Fora de escopo

- Não vou mexer em templates de auth email, domínio de email, ou provider Google.
- Não vou alterar telas de cadastro/login.

## Observação

Se depois de aplicar isso ainda chegar um email de confirmação, o próximo passo será investigar o `auth-email-hook` para ver se ele está enfileirando emails de signup mesmo com auto-confirm ativo — mas normalmente a configuração acima já resolve.
