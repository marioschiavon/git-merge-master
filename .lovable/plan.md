## Situação atual

O botão **já dispara** `resend-domain-verify` imediatamente ao ser clicado — a confusão está no **texto do toast**, que quando o Resend responde "ainda não verificado" mostra *"Estamos verificando automaticamente em segundo plano…"*, dando a impressão de que ele apenas agendou algo.

## Ajuste proposto

Arquivo: `src/pages/settings/Email.tsx` (mutation `verifyMutation`, ~linha 218-228).

Reescrever o toast para deixar claro:

- **Se verificou (`status === "verified"`)**: "Verificado! Sua empresa já pode enviar emails."
- **Se ainda não propagou**: título *"Verificação executada"* + descrição *"Checamos agora no Resend, mas o DNS ainda não propagou. Continuaremos verificando em segundo plano (a cada hora) e a tela atualiza sozinha assim que propagar."*
- **Se falhou** (`status === "failed"`): título *"Falha na verificação"* + orientar remover e recadastrar.

Também adicionar um pequeno texto auxiliar abaixo do botão quando o status for `pending`/`verifying`, algo como: *"Última verificação: HH:mm — próxima automática em segundo plano."* usando `verified_at`/`updated_at` do registro, para o usuário ter feedback visual de que o sistema está trabalhando.

Nenhuma mudança no comportamento do backend (cron continua 1x/hora, polling da página continua a cada 15s por ~5 min).

## Versão

Bump `APP_VERSION` em `src/lib/version.ts` para `beta 0.9`.

## Detalhes técnicos

- Sem migrations, sem alterações em edge functions.
- Mudança puramente de UI/copy em `Email.tsx`.
