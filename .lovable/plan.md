
# Migração Z-API → Hook7 (por fases)

Objetivo: substituir o provider Z-API pelo Hook7 (padrão do Leaderei Foundation), mantendo o fluxo atual (enviar/receber WhatsApp, cadências, inbound → IA) idêntico do ponto de vista do usuário. Z-API só sai do ar depois que Hook7 estiver validado em produção.

## Modelo de chaves (importante)

Duas camadas de credencial, exatamente como no Foundation:

1. **Chave global do Hook7** (`HOOK7_GLOBAL_APIKEY`)
   - Secret da plataforma, só o backend usa.
   - Serve para **operações administrativas** contra a API do Hook7: criar/apagar instâncias, testar conectividade e — quando aplicável — enviar mensagens transacionais/sistêmicas da própria plataforma para os *usuários do app* (não para os leads das empresas).
   - Master admin vê apenas *status* (configurada / ausente) e URL base. Nunca vê o valor.

2. **API key por instância (uma por número da empresa)**
   - Cada empresa cria uma ou mais **instâncias Hook7** em Integrações → WhatsApp → Gerenciar instâncias. Cada instância representa **um número de WhatsApp** dessa empresa.
   - No `POST /instance/create` (chamado com a chave global), o Hook7 devolve um **token dedicado** para aquela instância. Esse token é a "apikey" que autoriza **enviar mensagens pelo número daquela empresa**.
   - O token vive só no banco, criptografado (`hook7_instances.token_encrypted` via `pgp_sym_encrypt`), lido apenas por RPC `SECURITY DEFINER`. `company_admin` nunca vê o valor cru — apenas gerencia (conectar, ler QR, desconectar, apagar).
   - **Toda mensagem para lead da empresa X sai autenticada com o token da instância da empresa X**, garantindo que sai pelo número certo e isolando falhas entre tenants.

> Observação sobre Z-API: o que temos hoje é per-company também (linha em `integrations` com `provider='zapi_whatsapp'` e `config = { instance_id, token, ... }`), mas o *cliente* tinha que ir na Z-API, comprar/criar a instância manualmente e colar as credenciais. O ganho do Hook7 é que a plataforma cria a instância no ato e o cliente só lê o QR Code.

## Arquitetura alvo

- **Instâncias por empresa**: tabela `hook7_instances` com FK para `companies(id)`. Pode ter várias por empresa (um número por instância). Coluna `owner_user_id` fica reservada para o modo `per_user` futuro.
- **QR Code**: `company_admin` cria a instância, clica em Conectar, o app pede o QR ao Hook7 usando a **apikey da instância** e mostra na tela. Status atualiza por polling (3s) + webhook `CONNECTION`.
- **Webhook único** por projeto: `POST /functions/v1/hook7-webhook/{secret}/{company-slug}`. Recebe `MESSAGE`, `SEND_MESSAGE`, `READ_RECEIPT`, `CONNECTION`. Valida o `instanceToken` do envelope contra o token armazenado (garante que o evento é realmente daquela instância). Escreve em `messages` e encaminha para `inbound-webhook` (mesmo pipeline de IA de hoje).
- **Envio**: helper `hook7-whatsapp.ts` resolve a instância `connected` da empresa, decripta o token, chama `POST /message/send-text` com o **token da instância** no header `apikey`.

## Fase 1 — Fundação (sem tocar em Z-API)

**Migração SQL:**
- Tabela `public.hook7_instances`: `id`, `company_id` (FK), `owner_user_id?`, `display_name`, `external_id`, `external_name`, `status` (`pending_qr | qr_ready | pairing | connected | disconnected | banned | error`), `phone_number`, `connected_profile_name`, `token_encrypted bytea`, `last_connected_at`, `last_qr_at`, `user_disconnected_at`, `archived_at`, `created_by`, timestamps.
- GRANTs + RLS: `SELECT` para membros da empresa (via `get_user_company_id`), `ALL` para `company_admin` da empresa e `master_admin`. `REVOKE SELECT (token_encrypted)` de `authenticated` e `anon` — token nunca sai do banco em SELECT direto.
- Funções `SECURITY DEFINER`: `set_hook7_instance_token(_instance_id, _token)` e `get_hook7_instance_token(_instance_id)` (usam `pgp_sym_encrypt`/`decrypt` com passphrase vinda de secret via `current_setting`).
- Nova chave em `platform_settings`: `hook7_base_url` (default `https://api.hook7.com.br`) — editável pelo master.

**Secrets da plataforma:**
- `HOOK7_GLOBAL_APIKEY` — chave master do Hook7 (pedir ao usuário).
- `HOOK7_WEBHOOK_SECRET` — UUID gerado uma vez (`generate_secret`, 32 chars).
- `HOOK7_INSTANCE_TOKEN_PASSPHRASE` — passphrase de criptografia dos tokens de instância (`generate_secret`, 64 chars). **Não rotacionar sem plano de re-criptografia.**

## Fase 2 — Edge functions Hook7 (paralelas ao Z-API)

Sem tocar em nada do Z-API:

- `_shared/hook7.ts` — cliente HTTP (`hook7Fetch`), `buildExternalName(companySlug, displayName)`, `buildWebhookUrl(companySlug)`, `getBaseUrl()`.
- `_shared/hook7-whatsapp.ts` — `sendWhatsAppViaHook7(companyId, toPhone, body)` (resolve instância `connected`, decripta token via RPC, faz `POST /message/send-text` com o **token da instância**), `checkPhoneExistsOnHook7`.
- `hook7-instance-create` / `-connect` / `-qr` / `-status` / `-disconnect` / `-reconnect` / `-delete` / `-rename` — endpoints chamados pela UI, autenticados por JWT + checagem `company_admin` da empresa da instância. `create` usa a **chave global**; os demais usam o **token da própria instância**.
- `hook7-webhook` — endpoint público (`verify_jwt=false` no `supabase/config.toml`), path `/hook7-webhook/{secret}/{company-slug}`. Sempre 200. Valida `secret` e `instanceToken` do envelope. Trata `CONNECTION` (status + `connected_profile_name` + `phone_number`), `MESSAGE` inbound (insere em `messages` com `provider='hook7'` + `provider_message_id` e chama `inbound-webhook` com `skip_insert=true`), `MESSAGE` outbound `IsFromMe:true` (marca `delivered` no `messages` já existente via `provider_message_id`), `READ_RECEIPT` (marca `read`).
- `hook7-test-connection` — para o master admin validar a chave global (cria uma instância descartável e deleta).

## Fase 3 — UI (Integrações + Master)

- **Integrações** (`src/pages/settings/Integrations.tsx`): novo card "WhatsApp (Hook7)" com botão **Gerenciar instâncias** que abre um dialog `WhatsAppManagerDialog` (portado do Foundation, adaptado para chamar as edge functions da Fase 2). Cada linha da lista mostra: `display_name`, número conectado, status e ações (Conectar/QR, Desconectar, Renomear, Apagar). O token da instância nunca aparece na UI. Card antigo do Z-API permanece marcado como *Legado — será desativado*.
- **Master → Configurações da plataforma** (`PlatformSettings.tsx`): nova seção "WhatsApp · Hook7" com: status da `HOOK7_GLOBAL_APIKEY` (configurada / ausente), URL base editável (`hook7_base_url`), status do webhook, botão "Testar conexão".

Após Fase 3 é possível criar instância, ler QR e ver conectar — mas o envio real continua saindo por Z-API.

## Fase 4 — Chaveamento do envio e inbound

- Helper `resolveWhatsAppProvider(companyId)`: se existe instância Hook7 `connected` na empresa → `hook7`; senão, se `integrations` `zapi_whatsapp` ativa → `zapi`; senão falha com mensagem clara.
- Trocar as chamadas diretas a Z-API em: `send-outbound-message`, `cadence-executor`, `approval-execute`, `slot-expiry-followup`, `execute-action`. Sempre resolve provider antes → chama helper correspondente. `messages.metadata` passa a incluir `provider` e `hook7_message_id` (ou `zapi_message_id`) para dedup do webhook.
- `hook7-webhook` já ligado desde a Fase 2; empresas com instância conectada passam automaticamente a receber por ele. `zapi-webhook` continua vivo para quem ainda não migrou.

## Fase 5 — Aposentar Z-API

Só depois de o usuário confirmar em produção:
- Ao menos uma empresa com instância Hook7 conectada.
- Envio + recebimento + cadência validados de ponta a ponta.

Então:
- Remove cards e formulários Z-API de `Integrations.tsx`.
- Remove edge functions `zapi-webhook`, `zapi-test-connection` e `_shared/zapi-whatsapp.ts`.
- Remove ramo `zapi` do `resolveWhatsAppProvider` e do `send-outbound-message`.
- Marca `integrations` com `provider='zapi_whatsapp'` como `status='archived'` (não apaga histórico).

## Detalhes técnicos

- Cada fase é uma release independente e reversível.
- Até a Fase 4, o app continua enviando/recebendo por Z-API — nenhuma quebra.
- Dedup do webhook Hook7 usa `messages.provider='hook7'` + `provider_message_id` (colunas já existem).
- Testes manuais recomendados a cada fase:
  - F1: migração aplica; `SELECT token_encrypted` de `authenticated` bloqueado; `set/get` funcionam.
  - F2: `hook7-test-connection` OK; `hook7-webhook` responde 200 e loga eventos.
  - F3: criar instância na S7, ler QR, ver `status=connected` e `phone_number` preenchido.
  - F4: enviar mensagem manual pela inbox saindo pelo número da empresa; receber resposta e ver IA rodar.
  - F5: card Z-API sumiu, tudo continua funcionando.

## Fora do escopo (por enquanto)

- Modo `per_user` (uma instância Hook7 por membro). Entregamos só `shared` na Fase 3; `owner_user_id` já fica na tabela para evoluir depois.
- Migração automática das credenciais Z-API — cada empresa cria a instância Hook7 nova pela UI.
- Uso da chave global para envios sistêmicos ao *usuário do app* (transacionais tipo alerta de login): a infra vai estar pronta na Fase 1, mas nenhum caso de uso será cabeado agora.
