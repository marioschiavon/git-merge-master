## Envio e recebimento de email via Gmail (conta compartilhada)

Vamos usar o **connector Gmail** do Lovable (uma conta Gmail do dono do SaaS) para enviar emails de cadência e receber respostas dos leads dentro do app.

### Passo 1 — Conectar Gmail
Linkar o connector `google_mail` ao projeto com os escopos:
- `gmail.send` — enviar mensagens
- `gmail.readonly` — ler inbox
- `gmail.modify` — marcar como lida e adicionar labels

Após conectar, os secrets `LOVABLE_API_KEY` + `GOOGLE_MAIL_API_KEY` ficam disponíveis nas Edge Functions.

### Passo 2 — Envio via Gmail (`gmail-send`)
Nova Edge Function `supabase/functions/gmail-send/index.ts`:
- Input: `{ to, subject, html, lead_id, cadence_step_id?, in_reply_to_message_id? }`
- Monta RFC 2822 (com `From`, `To`, `Subject`, `Message-ID` único, `In-Reply-To`/`References` quando for reply) e codifica em base64url
- POST `https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send`
- Salva em `messages` (criando `conversation` se não existir) com `direction='outbound'`, guardando `gmail_message_id`, `gmail_thread_id` e o `Message-ID` RFC para casar respostas
- Substitui a chamada atual do `cadence-executor` para enviar email via Lovable Emails → agora invoca `gmail-send`

### Passo 3 — Recebimento via Gmail (`gmail-sync-inbox`)
Nova Edge Function rodando em cron (a cada 2 min via pg_cron + pg_net):
- Lê config `gmail_last_history_id` em `integrations` (provider `gmail`)
- 1ª execução: `users/me/messages?q=is:unread newer_than:1d&maxResults=50` e guarda `historyId`
- Execuções seguintes: `users/me/history?startHistoryId=...&historyTypes=messageAdded` (incremental, eficiente)
- Para cada mensagem nova:
  - Busca `messages/{id}?format=metadata` → extrai `From`, `Subject`, `In-Reply-To`, `References`, `threadId`, snippet
  - Casa o lead: primeiro por `gmail_thread_id` em `messages` existentes, depois por `In-Reply-To` → `messages.rfc_message_id`, por fim por `from_email` → `leads.email` (de qualquer empresa que tenha aquele lead)
  - Insere registro em `messages` com `direction='inbound'` e atualiza/cria `conversations`
  - POST `messages/{id}/modify` com `removeLabelIds: ["UNREAD"]` + adiciona label `Lovable/Processed`
- Atualiza `gmail_last_history_id`

### Passo 4 — Migration
Adicionar colunas em `messages`:
- `gmail_message_id text`, `gmail_thread_id text`, `rfc_message_id text`
- Índices em `gmail_thread_id` e `rfc_message_id`

Adicionar em `integrations` o provider `gmail` com `metadata` para guardar `last_history_id` e email da conta conectada.

### Passo 5 — UI
- Em **Configurações → Integrações**: card "Gmail" mostrando status (conectado/desconectado) + email da conta + botão "Sincronizar agora"
- Em **/conversations**: respostas chegam automaticamente; nenhuma mudança grande de UI necessária (já consome `conversations`/`messages`)

### Passo 6 — Cron
`pg_cron` chamando `gmail-sync-inbox` via `pg_net` a cada 2 minutos (mesmo padrão do `process-email-queue`).

### Limitações importantes (a comunicar ao usuário)
- **Tudo sai do mesmo endereço** — todos os leads de todas as empresas verão emails vindos de `voce@suaempresa.com`. Não dá pra personalizar remetente por empresa nesse modelo.
- **Limite Gmail**: ~500 envios/dia em conta gratuita, ~2000/dia em Google Workspace. Para volumes maiores precisaria de outra solução.
- **Roteamento de respostas**: se dois leads diferentes (em empresas diferentes) tiverem o mesmo email, o threading por `In-Reply-To` ainda funciona; o fallback por email pode ambiguar.

### Arquivos
- `supabase/functions/gmail-send/index.ts` (novo)
- `supabase/functions/gmail-sync-inbox/index.ts` (novo)
- `supabase/functions/cadence-executor/index.ts` (modificar — usar gmail-send para emails)
- `src/pages/settings/Integrations.tsx` (modificar — card Gmail)
- Migration: colunas em `messages`, registro `gmail` em `integrations`, cron job

### Próximo passo
Quando aprovar, vou pedir pra você conectar o Gmail (popup do Lovable) escolhendo os 3 escopos acima.
