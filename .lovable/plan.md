
## Objetivo

Esconder o menu **Intents & Ações** do sidebar. O backend (tabelas, `route-intent`, `intent-cron`, `execute-action`) fica intacto para não quebrar o fluxo existente do `inbound-webhook`.

## Mudanças

1. **`src/components/AppSidebar.tsx`** — remover o item de menu que aponta para `/settings/intents`.
2. **`src/App.tsx`** — manter a rota `/settings/intents` acessível por URL direta (não deletar), assim quem tiver link salvo não recebe 404. Alternativamente, remover a rota também. Vou **manter a rota** para minimizar risco.

## Fora de escopo

- Não altero `intent_action_rules`, `lead_action_queue`, `intent-cron`, `route-intent`, `execute-action`.
- Não mexo no `sdr-agent` nem em nenhuma edge function.
- Não agendo `intent-cron` (o usuário optou por só esconder o menu).

## Validação

- Abrir o sidebar e confirmar que "Intents & Ações" não aparece.
- Navegar manualmente para `/settings/intents` ainda carrega a página (rota preservada).
