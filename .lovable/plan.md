# Integração Bitrix24 — Conexão e Sincronização de Leads

## Onde estamos

- O **card do Bitrix24** já existe em Configurações → Integrações (categoria CRM), hoje como **"Em desenvolvimento"**, sem ação de conexão.
- Nada de backend existe ainda para o Bitrix24: sem edge functions, sem colunas na tabela `leads`, sem hooks.

## Próximo passo (esta etapa)

Transformar o card em uma integração funcional, **espelhando o modelo do Pipedrive**: o cliente conecta, sincroniza contatos/leads do Bitrix24 para o Leaderei e desconecta quando quiser.

### Autenticação: Webhook de entrada (REST) do Bitrix24

O cliente cola a **URL do webhook de entrada** que o próprio Bitrix24 gera (`https://{portal}.bitrix24.com.br/rest/{user_id}/{token}/`). É o equivalente ao "API token" do Pipedrive — simples para o cliente, sem app OAuth. Validamos a URL chamando `profile` na API do Bitrix24 no momento da conexão.

### O que será construído

1. **Edge function `bitrix24-connect`**
   - Recebe a URL do webhook + `company_id`.
   - Valida chamando `profile` no Bitrix24 (retorna nome do usuário e do portal).
   - Salva em `integrations` com `provider: "bitrix24"`, status `active` (mesma tabela do Pipedrive, upsert por company+provider).
   - Guard de tenant + permissão de admin (mesmo padrão das demais funções).

2. **Edge function `bitrix24-sync`**
   - Busca **contatos** (`crm.contact.list`, paginado) e **empresas** (`crm.company.list`) do Bitrix24.
   - Mapeia para `leads`: nome, email(s), telefone(s), cargo, empresa, site, cidade/estado/país; dados brutos em `pipedrive_data`-equivalente (usaremos uma coluna genérica ou `enrichment_data`).
   - Reconciliação: remove leads cuja origem é bitrix24 e que não existem mais lá.
   - Atualiza `last_synced_at` da integração.

3. **Banco de dados**
   - Nova coluna `leads.bitrix24_id` (inteiro) + índice único `(company_id, bitrix24_id)` — espelho do `pipedrive_id` existente.
   - Sem novas tabelas.

4. **Frontend**
   - Novo hook `src/hooks/useBitrix24.ts` com `useConnectBitrix24`, `useDisconnectBitrix24`, `useSyncBitrix24` (reaproveitando `useIntegration`).
   - Em `src/pages/settings/Integrations.tsx`: o card do Bitrix24 sai de "Em desenvolvimento" e ganha o mesmo comportamento do card do Pipedrive — dialog de conexão (campo para a URL do webhook + instruções de onde encontrá-la no Bitrix24), botões Sincronizar e Desconectar, e status real.

5. **Versão e patch log**
   - Bump em `src/lib/version.ts` e entrada em `docs/patch-logs/2026-08-31.md` em linguagem de cliente.

## O que NÃO entra nesta etapa (futuro)

- **Sincronização de negócios (deals/funis)** do Bitrix24 → bidirecional.
- **Envio do Leaderei → Bitrix24** (criar negócio no CRM quando um lead vira reunião/converte).
- OAuth app do Bitrix24 Marketplace (mais elegante, mas exige app publicado; o webhook atende agora sem fricção).

## Detalhes técnicos

- Arquivos novos: `supabase/functions/bitrix24-connect/index.ts`, `supabase/functions/bitrix24-sync/index.ts`, `src/hooks/useBitrix24.ts`.
- Arquivos alterados: `src/pages/settings/Integrations.tsx`, `src/lib/version.ts`, patch log, migração SQL (coluna + grants já existentes na tabela `leads` — apenas `ALTER TABLE`, sem novos GRANTs).
- Bitrix24 REST: `crm.contact.list` (com `start` para paginação em lotes de 50) e `profile` para validação.
- Segue o padrão multi-tenant: `requireCompanyMember` + verificação de admin como em `pipedrive-connect`.
