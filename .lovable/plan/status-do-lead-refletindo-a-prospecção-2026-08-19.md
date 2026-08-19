# Status do lead refletindo a prospecção

Hoje todo lead importado fica como "Novo" e assim permanece: nenhuma parte do sistema muda o status quando o lead entra numa cadência ou quando a primeira mensagem é enviada (verificado: nenhum ponto do código grava `contacted`). Por isso não dá para saber o que já foi enviado para prospecção.

## O que muda

1. Novo status **"Em cadência"** — aplicado assim que o lead é inscrito numa cadência (ação em lote em Leads e lançamento de campanha por lista).
2. Status **"Contatado"** — aplicado automaticamente quando a primeira mensagem realmente sai (e-mail ou WhatsApp), substituindo "Em cadência".
3. Status já avançados (Qualificado, Convertido, Desqualificado) nunca são rebaixados por essas regras.
4. Filtro de status na tela de Leads ganha a opção "Em cadência", com cor própria no badge (roxo/índigo) para diferenciar de "Novo" (azul) e "Contatado" (amarelo).
5. Retroativo: leads que já têm inscrição ativa passam a exibir o status correto (uma atualização única no banco).

Fluxo resultante: `Novo → Em cadência → Contatado → Qualificado/Desqualificado/Convertido`.

## Detalhes técnicos

- Migração: adicionar valor `enrolled` ao enum `lead_status`; backfill dos leads com `cadence_enrollments` (ativos → `enrolled`; com mensagem já enviada → `contacted`), só a partir de `new`.
- `supabase/functions/leads-bulk-action/index.ts` e `supabase/functions/launch-campaign/index.ts`: após criar os enrollments, atualizar os leads inscritos para `enrolled` quando o status atual for `new`.
- Marcação de `contacted` no envio efetivo: em `send-outbound-email` e `whatsapp-send-tick` (após sucesso), atualizar o lead quando o status for `new` ou `enrolled`.
- Frontend `src/pages/Leads.tsx`: `statusColors` / `statusLabels` + item no Select de filtro; `src/components/LeadFormDialog.tsx`: incluir `enrolled` no enum do form e no Select.
- Bump de `APP_VERSION` para `beta 0.34`.
