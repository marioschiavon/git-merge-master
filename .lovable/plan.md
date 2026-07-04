# Voltar 100% para o connector Google Mail da Lovable (rodada 1)

## Objetivo
Usar **apenas** o connector `google_mail` da Lovable para envio e leitura de Gmail, com um único Gmail conectado no workspace servindo **todas as companies**. O caminho OAuth próprio por company que construímos fica **desativado** (código removido do runtime), mas as tabelas e RPCs de OAuth ficam intactas para reativar no futuro sem migração.

Você (master_admin) vai conectar um **novo Gmail** no connector (não o e-mail antigo da outra empresa). Todos os envios e sincronização passam a sair desse endereço.

## Pré-requisitos

1. Nenhum connector `google_mail` está linkado ao workspace no momento (verificado).
2. Vou disparar `standard_connectors--connect` para `google_mail` — você escolhe qual conta Google autorizar. Autorize com o **novo Gmail** que servirá a plataforma.
3. Isso injeta a env var `GOOGLE_MAIL_API_KEY` nas edge functions. `LOVABLE_API_KEY` já existe.
4. Sem verification, sem consent screen: o connector da Lovable é OAuth deles, não do seu Google Cloud project. Zero fricção.

## Mudanças de código

### 1. `supabase/functions/gmail-send/index.ts` — reescrever
- Remove imports de `_shared/gmail-oauth.ts`.
- Não busca mais `gmail_account` do banco. Envia sempre pelo Gmail do connector:
  ```
  POST https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send
  Authorization: Bearer $LOVABLE_API_KEY
  X-Connection-Api-Key: $GOOGLE_MAIL_API_KEY
  Content-Type: application/json
  { "raw": "<base64url>", "threadId": "..." (opcional) }
  ```
- Monta o RFC 2822 com `To`, `Subject`, `In-Reply-To`, `References`, `Message-ID` (para threading).
- Persiste `messages` normalmente (`gmail_message_id`, `gmail_thread_id`, `rfc_message_id`) e `lead_activities`.
- Descobre e cacheia o e-mail conectado via `GET /users/me/profile` (usado no `From` implícito e para pular auto-loop no sync).

### 2. `supabase/functions/gmail-sync-inbox/index.ts` — reescrever
- Deixa de iterar `gmail_account`.
- Chama pela gateway:
  - `GET /users/me/history?startHistoryId=...` (guardando `last_history_id` em uma nova linha de config global — ver ponto 3) ou fallback `messages?q=is:unread newer_than:1d in:inbox&maxResults=25`.
  - `GET /users/me/messages/{id}?format=full` por mensagem.
  - `POST /users/me/messages/{id}/modify` com `removeLabelIds: ["UNREAD"]`.
- Matching de lead → conversa: **procura em todas as companies** (é uma inbox compartilhada). Preferência:
  1. `gmail_thread_id` já existente em `messages`.
  2. `In-Reply-To` / `References` casando com `rfc_message_id`.
  3. `from` → `leads.email` — se casar com **1 lead** único, usa a company dele; se casar com múltiplos leads em companies diferentes, escolhe o **mais recente** e registra `metadata.ambiguous_match: true`.
- Não grava se não achar lead (mesma política de hoje).

### 3. Nova tabela/config para `last_history_id` global
- Criar linha em `platform_settings` (tabela já existe) com `key = 'gmail_connector_history_id'` e `value = { history_id, email, updated_at }`. Sem migração de schema, só um upsert.

### 4. Remover uso do OAuth per-company do runtime
- Deletar/comentar chamadas a `_shared/gmail-oauth.ts` em `gmail-send`, `gmail-sync-inbox`, `inbound-webhook`, `referral-followup-cron`.
- **Manter os arquivos** `gmail-oauth-start`, `gmail-oauth-callback`, `_shared/gmail-oauth.ts` e a tabela `gmail_account` como estão — desligados, mas prontos para reativar.

### 5. `src/pages/settings/Gmail.tsx` — simplificar
- Nova UI: card "Gmail da Plataforma" mostrando o e-mail conectado no connector (obtido via edge function pequena `gmail-connector-status` que consulta `/users/me/profile` pela gateway).
- Para **master_admin**: botão "Trocar conta Gmail" que abre a instrução: `Para trocar, desconecte e reconecte o connector Google Mail nas configurações do workspace da Lovable`. (Não temos tool para forçar reconexão automática de outra conta — o master faz pela UI da Lovable.)
- Para **demais usuários**: só o card informativo, sem botão.
- Remover botão "Conectar Gmail" (OAuth próprio) desta rodada.

### 6. Ação operacional que preciso disparar
- Chamar `standard_connectors--connect` com `connector_id: "google_mail"` para você autorizar o **novo Gmail** no workspace. Sem isso, `GOOGLE_MAIL_API_KEY` não existe e as chamadas retornam 503 claro (`connector_not_linked`).

## Não muda
- Schema de `gmail_account`, `messages`, `conversations`, `lead_activities`.
- Fluxo de inbound webhook (só troca a origem do token).
- Cron de sync já configurado.

## Riscos / notas
- Todas as respostas de todos os leads caem na inbox física desse Gmail — você verá tudo por lá.
- Se dois leads em companies diferentes tiverem o **mesmo e-mail**, o matching é ambíguo. Marco `metadata.ambiguous_match` para você conseguir revisar.
- Rate limits do Gmail (250 quota units/user/segundo, 1 bilhão/dia por projeto) passam a ser compartilhados por todos os clientes.
- Para reverter e voltar ao OAuth por company depois, basta religar os imports em `gmail-send` e `gmail-sync-inbox` e reativar a UI — sem migração.

## Fora de escopo
- Não vou apagar tabela `gmail_account` nem as RPCs de OAuth.
- Não vou tocar em `gmail-oauth-start` / `gmail-oauth-callback`.
- Não vou submeter o app à verification do Google (não é necessário no caminho do connector).
