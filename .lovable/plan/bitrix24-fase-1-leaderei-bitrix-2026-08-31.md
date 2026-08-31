# Bitrix24 — Fase 1: Leaderei → Bitrix

Sincronização de mão única: quando um lead é abordado, nasce um negócio no Bitrix24 do cliente; quando a IA passa para humano, o negócio avança de etapa com o resumo da conversa. Nada é importado do Bitrix e nada é apagado.

## Estado atual verificado

- O card Bitrix24 existe em `src/pages/settings/Integrations.tsx` como "Em desenvolvimento", desabilitado.
- Não há nenhuma função de backend para Bitrix.
- A tabela `leads` já tem `handoff_required`, `handoff_reason`, `handoff_at`, `company_name`, `whatsapp` — os gatilhos podem se apoiar neles.
- `pipedrive-connect` usa `requireCompanyMember` do `_shared/tenant-auth.ts`; será o molde da conexão.
- Versão atual: `beta 0.47`.

## O que será construído

### Banco de dados (uma migration)

1. Novo provedor `bitrix24` no tipo de integrações. Reaproveita a tabela `integrations`: código do webhook, portal e um bloco de configuração (funil, etapa de criação, etapa de handoff, fonte, de/para de campos) — tudo vazio no início.
2. Fila `bitrix_sync_queue`: um item por lead e por evento (`create_deal`, `move_stage`), com tentativas, próximo horário e último erro. Chave única por lead+evento impede negócio duplicado.
3. Vínculo `bitrix_deals`: liga cada lead ao negócio criado no Bitrix (e ao contato/empresa lá). Tabela separada — nenhuma coluna nova em `leads`.
4. Dois gatilhos na tabela `leads` (um único trigger `AFTER UPDATE`) que apenas enfileiram: status virou "abordado" → `create_deal`; handoff ligado → `move_stage` com motivo e horário. Assim nenhuma função existente precisa ser tocada.

Ambas as tabelas com RLS: membros da empresa só enxergam as próprias linhas; escrita apenas pelo serviço.

### Backend (três funções novas)

- **`bitrix24-connect`** — recebe a URL do webhook, extrai portal/usuário/código, valida chamando `profile`, salva escopado por empresa. A resposta nunca devolve o código; só portal e nome do usuário.
- **`bitrix24-discover`** — somente leitura: lista funis, etapas, fontes e campos personalizados do Bitrix daquele cliente para montar o mapeamento na tela.
- **`bitrix24-queue-worker`** — roda por cron. Configuração incompleta → item marcado como "pulado", sem chute. Criação: acha ou cria contato (por e-mail, depois telefone) e empresa, cria o negócio no funil/etapa/fonte configurados com o de/para de campos, e grava o vínculo. Handoff: atualiza o negócio para a etapa seguinte. Erros recuam de forma exponencial (1min, 5min, 25min) e falham após 5 tentativas.

### Tela

- Novo hook `src/hooks/useBitrix24.ts` reaproveitando `useIntegration` (conectar, desconectar, descobrir, salvar configuração). Sem sincronização manual.
- O card Bitrix24 deixa de ser "em desenvolvimento" e ganha: diálogo de conexão com instruções de onde achar a URL no Bitrix; depois de conectado, selects de funil, etapa de criação, etapa de handoff e fonte; de/para de campos (Leaderei à esquerda, Bitrix à direita); painel da fila com pendentes, falhas e último erro; botão Desconectar.
- Campos do Leaderei oferecidos no de/para: nome, e-mail, telefone, whatsapp, cargo, empresa, site, endereço, origem, status e score.

### Versão

`beta 0.48` em `src/lib/version.ts` e entrada nova em `docs/patch-logs/2026-08-31.md`, em linguagem de cliente.

## Notas técnicas

- Toda chamada ao Bitrix acontece em Edge Function. O código do webhook vai na URL (`/rest/USER_ID/CODIGO/metodo`), nunca em header, nunca no navegador, nunca em `VITE_*`.
- Métodos usados: `profile`, `crm.category.list` (fallback `crm.dealcategory.list`), `crm.dealcategory.stage.list`, `crm.status.list`, `crm.deal.fields`, `crm.contact.list/add`, `crm.company.list/add`, `crm.deal.add/update/get`.
- Etapas são strings (`NEW`, `C5:UC_...`) e campos personalizados são códigos (`UF_CRM_...`) — sempre vindos de configuração, nunca fixos no código.
- Worker: timeout de 10s por chamada, no máximo 2 requisições por segundo, ~20 itens por execução, token nunca em log.
- Nenhum `delete()` em `leads` em nenhum ponto do código novo; nenhuma função existente é modificada.

## Fora de escopo

Importar contatos/empresas do Bitrix, webhook de volta quando o vendedor move o card, OAuth do Marketplace, qualquer reconciliação destrutiva.
