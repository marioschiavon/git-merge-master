## Objetivo

Reprocessar os domínios Resend cadastrados antes da Fase 2 para que ganhem `inbound_domain`, MX de recebimento e roteamento ativo, sem precisar recadastrar o domínio.

Hoje temos 1 domínio nessa situação (`leaderei.app.br`, status `verified`, `inbound_domain` vazio, `inbound_status` `pending`).

## O que vai ser feito

### 1. Nova edge function `resend-inbound-backfill`

- Só pode ser chamada por `master_admin` (verifica `has_role`).
- Aceita opcionalmente `company_id`. Sem parâmetro, processa todos os domínios em que `inbound_domain IS NULL` ou `inbound_dns_records IS NULL`.
- Para cada domínio:
  1. Ativa `capabilities.receiving: enabled` no Resend via `PATCH /domains/:id` (idempotente).
  2. Refaz `GET /domains/:id` e extrai o(s) registro(s) MX `inbound-smtp...`.
  3. Calcula `inbound_domain = "inbound." + sending_domain`.
  4. Persiste `inbound_domain`, `inbound_dns_records`, `inbound_status = 'pending'`, `inbound_configured_at = now()`.
  5. Garante o webhook global chamando `ensureInboundWebhook()`.
- Retorna resumo `{ processed, updated, errors[] }`.

### 2. Botão no Master Admin

- Em `src/pages/master/PlatformSettings.tsx` (bloco Resend), adicionar botão "Reprocessar domínios antigos" que chama a nova função e mostra o resultado num toast.
- Log em `audit_logs` (`event: 'resend.inbound_backfill'`).

### 3. Fallback automático no cron existente

- `resend-domain-verify-cron` já roda de hora em hora. Adicionar: se o domínio está `verified` mas `inbound_domain IS NULL`, aplica o mesmo backfill antes da verificação normal. Assim qualquer domínio esquecido é corrigido sozinho.

### 4. UI do cliente

- Em `src/pages/settings/Email.tsx`, quando o domínio já existir mas ainda não tiver `inbound_domain`, mostrar aviso "Estamos habilitando o recebimento…" e disparar `resend-domain-verify` (que agora também faz o backfill via cron/função) ao abrir a página. Nada de novo botão manual para o cliente — o próximo ciclo de verificação resolve.

### 5. Versão

- `APP_VERSION` sobe para `beta 0.5`.

## Detalhes técnicos

- Nenhuma migração de schema é necessária — as colunas `inbound_*` em `company_email_domains` já existem.
- `ensureInboundWebhook()` é idempotente (usa `platform_settings.resend_inbound_webhook_id`), então rodar N vezes não duplica webhook.
- Se `PATCH /domains/:id` falhar (por ex. plano Resend sem inbound), a função grava `last_error` e segue para o próximo, sem abortar o lote.
- Idempotência: rodar o backfill em domínio que já tem `inbound_domain` é no-op.

## O que fica fora deste plano

- Painel de logs de webhooks recebidos no Master Admin (fica pra próxima).
- Reprocessar mensagens de reply que chegaram enquanto o inbound estava desligado (não temos histórico delas — Resend não entregou).
