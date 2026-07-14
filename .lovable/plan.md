## O que aconteceu

A regra em `src/lib/version.ts` diz que cada alteração significativa deve incrementar `APP_VERSION` em +0.01. Ficou em `alpha 0.21`, mas desde então foram feitas pelo menos duas alterações significativas sem bump:

1. **Filtro do webhook Hook7** — `hook7-webhook` passou a ignorar mensagens de números não cadastrados (mudança de comportamento em produção).
2. **Limpeza Z-API / Twilio (Fase 1)** — remoção de 4 edge functions, 2 helpers compartilhados e do card Z-API em `Integrations.tsx`.

As atualizações do manual não contam como bump (só documentação).

## Proposta

Atualizar `src/lib/version.ts`:

- `APP_VERSION = "alpha 0.21"` → `APP_VERSION = "alpha 0.23"` (dois bumps acumulados).

Nenhuma outra alteração de código. Continua valendo a regra: a cada próxima alteração significativa, eu subo +0.01 no mesmo commit da mudança. Só sai de `alpha` para `1.xx` quando você avisar explicitamente que está em produção real.

## Fora de escopo

- Não vou reescrever histórico nem tentar reconstruir bumps intermediários — só alinho no valor atual correto.
- `package.json` continua em `0.0.0` (não é usado como versão visível do app).

Confirma alpha 0.23, ou prefere outro número?