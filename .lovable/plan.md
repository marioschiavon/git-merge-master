# Migração Gmail → Resend (multi-domínio por company)

## Objetivo

Substituir a integração Gmail (envio + inbox sync) pelo **Resend via connector Lovable**. Cada company cadastra seu próprio sending domain (`mail.clientedele.com`) no Resend, verifica DKIM/SPF no DNS e passa a enviar com o `from` do domínio dela — reputação fica isolada por cliente, `leaderei.com.br` não é mais usado como remetente.

Respostas dos leads voltam via **Resend Inbound** para o webhook existente.

## Arquitetura

```text
                  ┌──────────────────────────────────┐
Company A ─────►  │ email_domains (por company_id)   │
Company B ─────►  │   sending_domain, resend_domain_id│
Company C ─────►  │   status, verified_at             │
                  └──────────────┬───────────────────┘
                                 │
    envio ─►  send-outbound-email (edge)  ─►  Resend API (gateway)
                                                    │
                                                    ▼
                                             Cliente recebe
                                                    │  responde ↩
                                                    ▼
    resend-inbound-webhook (edge)  ◄────  Resend Inbound (MX)
              │
              ▼
       inbound-email-webhook (existente: casa com lead, cria message)
```

## Escopo

### 1. Conector Resend
- Linkar o connector `resend` no workspace (via `standard_connectors--connect`), gerando `RESEND_API_KEY` no projeto.

### 2. Nova tabela `company_email_domains`
Campos: `id`, `company_id` (unique — 1 domínio por company nesta v1), `sending_domain` (ex.: `mail.acme.com`), `from_name`, `from_email` (ex.: `sdr@mail.acme.com`), `reply_to`, `resend_domain_id`, `status` (`pending`/`verifying`/`verified`/`failed`), `dns_records` (jsonb — SPF/DKIM/MX/DMARC retornados pelo Resend), `verified_at`, `last_error`, timestamps.
RLS: company_admin/master_admin da company; GRANTs padrão.

### 3. Edge functions Resend (novas)
- `resend-domain-create` — cria domínio no Resend para a company, salva `resend_domain_id` e registros DNS a exibir.
- `resend-domain-verify` — dispara verify no Resend, atualiza status.
- `resend-domain-status` — consulta status atual (usado pelo polling da UI).
- `resend-domain-delete` — remove domínio do Resend e do banco.
- `send-outbound-email` — envia via Resend gateway. Recebe `{ lead_id, subject, html, text, thread_headers? }`, resolve o `company_email_domains` da company do lead, envia com `from` correto, persiste `message` outbound com `provider_message_id`.
- `resend-inbound-webhook` — recebe payload Inbound do Resend (com secret compartilhado), normaliza para o mesmo formato do `inbound-email-webhook` atual e delega (ou reusa `stripQuotedEmail` + matching por lead/thread).

### 4. Substituir chamadas de envio
Todos os pontos que hoje chamam `gmail-send` passam a chamar `send-outbound-email`:
- `cadence-executor`
- `send-outbound-message` (branch email)
- `generate-reply` / `human-suggest-reply` handoffs de email
- Qualquer outro caller identificado no `rg gmail-send`.

### 5. UI — nova página `/settings/email` (substitui `/settings/gmail`)
- Card por company: status do domínio, `from` configurado, botão "Adicionar domínio de envio".
- Wizard: input `mail.seudominio.com` → cria no Resend → exibe tabela com registros DNS (SPF/DKIM/MX/DMARC) para o cliente configurar no registrar dele → botão "Verificar" (polling status).
- Configuração de `from_name`, `from_email`, `reply_to`.
- Estatísticas 7d (enviados/recebidos) reusando `messages` (já existe lógica).
- Aviso claro: "A reputação de envio pertence ao seu domínio."
- Link master_admin para `/settings/integrations` ajustado.

### 6. Remoção completa do Gmail
Deletar:
- Frontend: `src/pages/settings/Gmail.tsx`, hooks/rotas do Gmail em `App.tsx`, card Gmail em `src/pages/settings/Integrations.tsx`, referências em `AppSidebar`.
- Edge functions: `gmail-connector-status`, `gmail-oauth-start`, `gmail-oauth-callback`, `gmail-send`, `gmail-sync-inbox`.
- Shared: `_shared/gmail-connector.ts`, `_shared/gmail-oauth.ts`.
- Banco (migração): drop `gmail_account`, drop RPCs `set_gmail_oauth_tokens`, `get_gmail_oauth_tokens`, `update_gmail_access_token`, `mark_gmail_error`; remover coluna `messages.gmail_message_id` (renomear para `provider_message_id` genérico) e `metadata` mantém.
- Secrets: remover `GMAIL_TOKEN_PASSPHRASE`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, desconectar connector Google Mail.
- Cron: qualquer cron que dispare `gmail-sync-inbox`.

### 7. Webhook Inbound
- Configurar (manualmente no Resend, uma vez) uma Inbound Route apontando para `https://<projeto>.functions.supabase.co/resend-inbound-webhook`.
- Instruir cada cliente a adicionar o MX do Resend Inbound no `mail.dominio.com` (aparece no wizard junto com os outros registros).
- Signing secret `RESEND_INBOUND_SECRET` salvo via `add_secret` (o valor o próprio dev define no dashboard do Resend e cola no Lovable).

### 8. Docs / memória
- Atualizar `mem://index.md` — remover menção a Gmail, adicionar "Email via Resend multi-tenant (1 domínio por company, reputação isolada)".
- README curto em `docs/email-resend-multitenant.md`.

### 9. Versionamento
Bump `APP_VERSION` para `alpha 0.20`.

## Ordem de execução

1. Linkar connector Resend + pedir `RESEND_INBOUND_SECRET`.
2. Migração DB (nova tabela, drop Gmail).
3. Edge functions Resend + `send-outbound-email` + `resend-inbound-webhook`.
4. Trocar callers de `gmail-send` → `send-outbound-email`.
5. Nova UI `/settings/email` + remoção da UI Gmail.
6. Deletar edge functions Gmail e shared.
7. Bump versão.

## Fora do escopo (fica para depois)

- Múltiplos sending domains por company.
- Webhooks de bounce/complaint (`suppressed_emails`) — pode ser feito em fase 2 usando os eventos do Resend.
- Migração de histórico Gmail existente (mensagens antigas continuam no banco, campo renomeado para `provider_message_id` mantém compatibilidade).
