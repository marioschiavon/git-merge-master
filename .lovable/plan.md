# Tela dedicada de configuração e monitoramento do Gmail

Hoje a integração Gmail vive só num diálogo pequeno em `/settings/integrations`. Vou criar uma **página dedicada por company** com status, histórico e ações — mantendo o cartão da lista de integrações como atalho.

## O que a tela mostra

Rota nova: `/settings/gmail` (protegida, escopada pela company do usuário via RLS existente em `gmail_account`).

Seções:

1. **Header de status da conta**
   - Email conectado, `is_active`, data de conexão (`created_at`).
   - Badge: Conectado / Desconectado / Erro (deriva do último log).
   - Botão "Sincronizar agora" (invoca `gmail-sync-inbox`, mesma chamada de hoje).

2. **Cards de resumo (últimos 7 dias)**
   - Última sincronização (`gmail_account.last_synced_at`) + tempo relativo.
   - Emails enviados (contagem `email_send_log` status `sent`, dedupe por `message_id`).
   - Falhas (`dlq` + `failed`).
   - Respostas processadas na última sync (retornado por `gmail-sync-inbox`, guardado em memória via React Query).

3. **Última execução (detalhe)**
   - Timestamp, resultado (`processed`, `matched`, erros) — usando o retorno mais recente do invoke.
   - Se houve erro, mostra a mensagem.

4. **Histórico de envios (tabela)**
   - Últimos 50 registros de `email_send_log` filtrados pela company (via RLS).
   - Colunas: Template, Destinatário, Status (badge colorido), Timestamp, Erro.
   - Dedupe por `message_id` mantendo o mais recente (regra do email dashboard).

5. **Ações**
   - Sincronizar inbox agora.
   - Desconectar conta (marca `is_active = false`).
   - Link para docs internos de configuração.

## Mudanças de código

- `src/pages/settings/Gmail.tsx` — nova página, usa `useGmailAccount`, novo hook `useGmailStats` (query em `email_send_log`) e mutation de sync/disconnect.
- `src/App.tsx` — registrar rota `/settings/gmail`.
- `src/pages/settings/Integrations.tsx` — no card Gmail, trocar `onAction` para `navigate("/settings/gmail")` em vez de abrir dialog (mantém o dialog como fallback para "Sincronizar rápido" ou remove — vou remover para evitar duplicidade).
- Sidebar/menu de Settings (se listar itens) — adicionar link "Gmail".

## Detalhes técnicos

- Isolamento: `gmail_account` e `email_send_log` já têm RLS por `company_id` (via `get_user_company_id`). Nenhuma migration necessária.
- Sem novas edge functions — reusa `gmail-sync-inbox`.
- Dedup query em `email_send_log`: `SELECT DISTINCT ON (message_id) ...` via RPC não é necessário; faço dedupe no client sobre os últimos 200 registros ordenados por `created_at desc`.
- Estado "Desconectado" quando não há linha em `gmail_account` — CTA explica que a conexão inicial acontece na primeira sync (fluxo atual do backend).
