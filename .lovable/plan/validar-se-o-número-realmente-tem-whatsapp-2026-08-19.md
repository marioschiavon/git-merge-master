# Validar se o número realmente tem WhatsApp

## Problema

Hoje todo lead com telefone aparece com o ícone do WhatsApp, mesmo que o número não exista no WhatsApp. O motivo é que a checagem existe no código, mas está desativada: `checkPhoneExistsOnWhatsApp` em `supabase/functions/_shared/hook7-whatsapp.ts` sempre responde `exists: true`, com o comentário de que o endpoint do Hook7 não estava confirmado.

Boa notícia: as colunas de resultado já existem na tabela `leads` (`whatsapp_valid`, `whatsapp_checked_at`, `whatsapp_check_error`, `whatsapp_source`) e hoje estão sem uso real.

## O que fazer

### 1. Ativar a checagem real (Hook7 / Evolution)

O backend do Hook7 é Evolution, que expõe a verificação de números em lote (`whatsappNumbers`, recebendo uma lista e devolvendo `exists` + o JID correto). Como o Hook7 usa caminhos próprios (`/send/text` em vez do padrão Evolution), a implementação vai tentar, em ordem, os caminhos conhecidos e usar o primeiro que responder — o caminho que funcionar fica registrado em `platform_settings` para não repetir o teste a cada chamada.

Resultado por número: `valid` (existe), `invalid` (não existe) ou `unknown` (falha de rede/endpoint indisponível). Nunca marcar como inválido em caso de erro.

### 2. Persistir o resultado no lead

Gravar em `whatsapp_valid`, `whatsapp_checked_at`, `whatsapp_check_error` e `whatsapp_source`. Revalidar apenas quando o número muda ou quando a última checagem tem mais de 30 dias.

### 3. Nova função de verificação em lote

`whatsapp-verify-numbers`: recebe uma lista de leads (ou varre os pendentes da empresa), verifica em blocos respeitando o limite da instância conectada e grava os resultados. Roda via cron diário para os pendentes e também sob demanda pelo botão da tela de Leads.

### 4. Usar o resultado no envio

- No enfileiramento de WhatsApp (`cadence-executor`, `cadence-agent-decide`, `whatsapp-send-tick`): antes do primeiro envio a um lead sem checagem, verificar na hora. Se der `invalid`, não enviar — marcar o item da fila como falha com motivo "número sem WhatsApp" e, na cadência multicanal, cair para e-mail quando houver.
- Números `unknown` continuam sendo enviados normalmente.

### 5. UI

- `ChannelBadges`: ícone do WhatsApp em cor normal quando validado, esmaecido com tooltip "WhatsApp não verificado" quando ainda não checado, e oculto/riscado com tooltip "Número sem WhatsApp" quando inválido.
- Tela de Leads: filtro "WhatsApp válido" e ação em lote "Verificar WhatsApp" na barra de seleção.
- Detalhe do lead: linha mostrando o status e a data da última verificação, com botão "Verificar agora".

### 6. Documentação

Adicionar em `docs/manual/08-leads.md` uma seção curta sobre o status de verificação de WhatsApp.

## Detalhes técnicos

- Arquivos tocados: `_shared/hook7-whatsapp.ts` (checagem real + cache do caminho), nova função `whatsapp-verify-numbers` (+ cron), `cadence-executor`, `cadence-agent-decide`, `whatsapp-send-tick`, `src/components/lead/ChannelBadges.tsx`, `src/pages/Leads.tsx`, `src/components/LeadDetailContent.tsx`, `src/hooks/useBulkLeadActions.ts`.
- A verificação exige uma instância WhatsApp conectada da empresa; sem instância o status fica `unknown` e nada é bloqueado.
- Sem mudança de schema (as colunas já existem); apenas um campo novo em `platform_settings` para guardar o caminho do endpoint descoberto.
- Bump de versão para `beta 0.33`.

## Risco e mitigação

Consultas de existência em volume alto são um sinal de spam para o WhatsApp. Mitigação: blocos pequenos, intervalo entre blocos, cache de 30 dias e verificação preferencialmente sob demanda/no momento do primeiro envio, em vez de varrer a base inteira de uma vez.
