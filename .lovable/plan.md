## Diagnóstico

Comparei as duas páginas de Integrações:

**Leaderei Foundation** (`_app.dashboard.integrations.tsx`)
- Layout: header + banner explicativo + 4 cards de resumo (Disponíveis / Conectadas / Pendentes / Com erro) + grid 3 colunas de provider cards.
- Cada card tem: ícone de marca (react-icons), nome, categoria, badge de status colorido (Conectado/Pendente/Erro/Desconectado), bloco "Status operacional / Último sync / Readiness", e botão único "Configurar" ou "Gerenciar" que abre um Dialog dedicado.
- Backend: tabelas `integration_providers` + `organization_integrations` + `integration_credentials` (catálogo dinâmico), server functions do TanStack Start, e o WhatsApp usa o serviço próprio "Hook7".

**Projeto atual** (`src/pages/settings/Integrations.tsx`)
- Layout: uma sequência vertical de cards grandes, cada provider com seu próprio form embutido (Pipedrive, Gmail, Cal.com, Z-API), sem visão de conjunto e sem hierarquia visual clara.
- Backend: tabela única `integrations` (provider, config, status) + edge functions por provider. Funciona perfeitamente — Pipedrive, Gmail, Cal.com e Z-API já operam em produção.

## Qual está melhor

A do **Foundation está visualmente melhor** (grid escaneável, brand icons, resumo agregado, badges de status consistentes, dialogs focados). Porém o backend do Foundation depende de um modelo de dados que este projeto não tem (catálogo `integration_providers`, `organization_integrations`, Hook7 para WhatsApp, server functions do TanStack Start).

Portar o backend inteiro seria um refactor grande e quebraria integrações que já funcionam. Por isso vou **manter o backend atual** (que está funcionando) e **portar somente o estilo/estrutura visual do Foundation**.

## O que muda

Reescrever apenas `src/pages/settings/Integrations.tsx` para adotar o layout do Foundation, sem alterar hooks, edge functions ou schema.

### Estrutura da nova página

1. **Header** — título "Integrações" + descrição curta.
2. **Banner informativo** — bloco `border-brand/20 bg-brand/5` explicando o modelo de conectores (mesmo tom do Foundation).
3. **4 SummaryCards** — Disponíveis / Conectadas / Pendentes / Com erro, contando os providers locais.
4. **Grid 3 colunas** com um `ProviderCard` por integração:
   - Pipedrive, Gmail, Cal.com, WhatsApp (Z-API), Twilio WhatsApp, LinkedIn (placeholder "em breve").
   - Cada card: ícone de marca + nome + categoria (CRM/Email/Agenda/Mensageria) + badge de status + bloco "Status operacional / Último sync / Readiness" + botão "Configurar" ou "Gerenciar".
5. **Dialogs dedicados** — extrair os formulários atuais (Pipedrive, Gmail, Cal.com, Z-API) para componentes `*ConnectionDialog` abertos pelo botão do card. `EnrichmentSettingsCard` continua abaixo do grid.

### Mapa de status → visual

Reusar `STATUS_META` do Foundation (`connected` verde, `pending` âmbar, `error` vermelho, `disconnected` cinza), derivando o status a partir do que já vem de `useIntegration(provider)` / `gmail_account.is_active` / presença de `CALCOM_API_KEY`.

### Ícones de marca

Instalar `react-icons` para usar `SiResend`, `SiWhatsapp`, `SiCalendly`, `SiHubspot` + `FaLinkedin`. Ícones customizados para Pipedrive e Apollo (SVGs inline vindos do Foundation). Gmail usa `Mail` do lucide.

### Preservado (sem alteração)

- Hooks: `useIntegration`, `useConnectPipedrive`, `useDisconnectPipedrive`, `useSyncLeads`.
- Edge functions: `pipedrive-connect`, `pipedrive-sync`, `gmail-sync-inbox`, `zapi-test-connection`, etc.
- Schema `integrations` e políticas RLS.
- Webhook Z-API (URL copiável dentro do dialog).

## Arquivos afetados

- Reescrever: `src/pages/settings/Integrations.tsx`.
- Novos (opcional, se ficar grande): `src/components/integrations/{PipedriveDialog,GmailDialog,CalcomDialog,ZapiDialog}.tsx`.
- Dependência nova: `react-icons`.

## Fora de escopo

- Não migrar para o modelo `integration_providers`/`organization_integrations`.
- Não mexer em Hook7 nem em nenhuma edge function.
- Não alterar `EnrichmentSettingsCard`.

Confirma que sigo com essa abordagem (manter backend, portar apenas o visual)?
