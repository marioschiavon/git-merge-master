# Fase 2 — Inbound de respostas por subdomínio dedicado

## Resumo da arquitetura

Cada cliente terá um subdomínio exclusivo para receber respostas, no padrão `reply.dominiodocliente.com.br`. Esse subdomínio recebe um MX próprio do Resend Inbound. Como a conta Resend usada é a conta master do Leaderei, cadastraremos **um único webhook global** `email.received` apontando para o Edge Function `resend-inbound-webhook`. Quando uma resposta chega, o webhook identifica a empresa pelo domínio do destinatário (`to`) e depois associa ao lead pelo email do remetente, garantindo isolamento multi-tenant.

## O que foi confirmado

- A API do Resend permite habilitar receiving em um domínio via `PATCH /domains/{id}` com `capabilities.receiving = "enabled"`.
- Após habilitar, a API retorna o registro MX de inbound no objeto `records`.
- A API do Resend permite criar webhooks via `POST /webhooks` com eventos `email.received`; a resposta inclui `id` e `signing_secret`.
- A tabela `company_email_domains` hoje tem `sending_domain`, `from_email`, `reply_to`, `dns_records`, `status`, mas não tem campos de inbound.
- O Edge Function `resend-inbound-webhook` hoje casa o lead globalmente pelo email do remetente, sem verificar a empresa destinatária.

## Plano de implementação

### 1. Migration no banco — adicionar campos de inbound

- Adicionar em `company_email_domains`:
  - `inbound_domain` (text) — ex: `reply.cliente.com.br`
  - `inbound_dns_records` (jsonb) — MX de recebimento retornado pelo Resend
  - `inbound_status` (text) — `pending` / `verifying` / `verified` / `failed`
  - `inbound_configured_at` (timestamptz)
- Adicionar em `platform_settings` (singleton):
  - `resend_inbound_webhook_id` (text)
  - `resend_inbound_webhook_secret` (text) — `signing_secret` retornado pelo Resend, para validar Svix
- Manter GRANTs e RLS existentes; `service_role` já acessa.

### 2. Atualizar `resend-domain-create`

- Após criar ou reusar o domínio no Resend, fazer `PATCH /domains/{id}` com `{ "capabilities": { "receiving": "enabled" } }`.
- Buscar o domínio atualizado para obter o registro MX de inbound.
- Calcular o subdomínio de recebimento: `reply.<root_domain>`, onde `root_domain` é o domínio raiz extraído de `sending_domain` (ex: `mail.cliente.com.br` → `cliente.com.br` → `reply.cliente.com.br`).
- Se o usuário não enviou `reply_to`, preencher automaticamente com `{from_local}@{inbound_domain}` (ex: `atendimento@reply.cliente.com.br`).
- Incluir o MX de inbound junto aos registros DNS exibidos na UI (mantendo DMARC e SPF/DKIM).
- Salvar `inbound_domain`, `inbound_dns_records`, `inbound_status = pending` no banco.
- Garantir o webhook global: verificar `platform_settings.resend_inbound_webhook_id`. Se não existir, criar via `POST /webhooks` apontando para `${SUPABASE_URL}/functions/v1/resend-inbound-webhook` com eventos `["email.received"]`, e armazenar `id` + `signing_secret` em `platform_settings`.

### 3. Atualizar `resend-domain-verify` e `resend-domain-verify-cron`

- Após buscar o domínio no Resend, garantir que `capabilities.receiving` esteja `enabled`; se não estiver, reabilitar.
- Preservar os registros "manuais" que não vêm do Resend: DMARC e MX de inbound (assim como já faz hoje com DMARC).
- Verificar o status do registro MX de inbound e atualizar `inbound_status`.
- Quando o MX estiver verificado, gravar `inbound_configured_at = now()`.
- No cron, aplicar a mesma lógica para domínios em `pending` / `verifying` e gerar `last_error` orientativo se o inbound não verificar após 72h.

### 4. Atualizar `resend-inbound-webhook`

- Verificar a assinatura Svix do webhook usando o `signing_secret` salvo em `platform_settings` (com fallback para `RESEND_INBOUND_SECRET` se já estiver configurado manualmente).
- Extrair o domínio do primeiro destinatário (`to`).
- Buscar em `company_email_domains` onde `inbound_domain` seja igual ao domínio recebido. Se não encontrar, retornar `200` sem erro (evita retries do Resend) e logar.
- Somente após identificar a empresa, buscar o lead pelo email do remetente **dentro dessa empresa** (`company_id`).
- Criar/identificar `conversation` com `channel = email` e inserir a mensagem `inbound`.
- Continuar invocando `inbound-webhook` para classificação/ações downstream.

### 5. Atualizar tela de Email (`src/pages/settings/Email.tsx`)

- Exibir o subdomínio de recebimento (`reply.…`) e seu status em card próprio.
- Incluir o MX de inbound na tabela de registros DNS, com botão de copiar nome e valor.
- Incluir "Subdomínio de recebimento" no checklist de entregabilidade (`DeliverabilityCard`).
- Se o inbound estiver pendente, mostrar instrução de adicionar o MX no DNS e botão "Verificar recebimento".
- Atualizar o preview do remetente para indicar que respostas irão para `reply_to`.

### 6. Ajustar envio outbound

- Em `send-outbound-email`, manter o uso de `reply_to` salvo em `company_email_domains`.
- Como o `resend-domain-create` já preencherá `reply_to` com o endereço do subdomínio inbound, as respostas do lead naturalmente voltarão pelo Resend Inbound.
- Garantir `In-Reply-To` / `References` para manter threading em respostas subsequentes.

### 7. Documentação e versão

- Atualizar `docs/manual/03b-email-resend.md` incluindo a seção de subdomínio `reply.` e o registro MX de inbound.
- Atualizar a mensagem de status do checklist de entregabilidade.
- Subir a versão de `beta 0.3` para `beta 0.4`.

## Validação após implementação

1. Criar um domínio de teste e confirmar no dashboard do Resend que "Receiving" está habilitado.
2. Verificar que o registro MX de inbound aparece na tabela de DNS da tela Email.
3. Adicionar o MX de `reply.<dominio>` no provedor de DNS.
4. Enviar email de prospecção e responder para o endereço de `reply-to`.
5. Confirmar que a resposta aparece na conversa do lead no Leaderei.
6. Verificar logs do Edge Function para garantir que não houve casamento cruzado entre empresas.

## Observações importantes

- A conta Resend é única (master), então o webhook `email.received` também é único; o roteamento por empresa é feito pelo domínio de destino.
- O valor exato do MX de inbound é fornecido pela API do Resend e não será hardcoded, evitando quebras se o Resend mudar o endpoint.
- A assinatura Svix do webhook será validada com o segredo retornado na criação, aumentando a segurança do endpoint.
- O subdomínio de recebimento fica separado do subdomínio de envio, evitando conflito com o MX de feedback/bounce que já existe no envio.