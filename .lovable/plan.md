## Objetivo

Cada company conecta o próprio Gmail via OAuth 2.0 do Google e todos os envios/sync passam a usar os tokens dessa company. O connector global `google_mail` do Lovable é removido do fluxo.

## Guia passo-a-passo — Google Cloud (o que você precisa fazer manualmente)

Vou te mandar isso no chat, com a **redirect URI exata** já pronta para colar. Resumo:

1. Google Cloud Console → criar projeto (ou usar existente)
2. **APIs & Services → Library** → ativar **Gmail API**
3. **OAuth consent screen** → tipo **External**, publicar em produção; adicionar escopos `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.modify`
4. **Credentials → Create OAuth Client ID → Web application**
   - Authorized redirect URI: `https://plfcbbqzpcbgykfervnp.supabase.co/functions/v1/gmail-oauth-callback`
5. Copiar **Client ID** e **Client Secret** → guardar em secrets `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`

Sem esses secrets nada funciona; o botão "Conectar Gmail" fica desabilitado com aviso.

## Mudanças de banco

Extender `gmail_account` (que já é por `company_id`) para guardar tokens OAuth por company:

- `refresh_token` (text, criptografado com pgp_sym_encrypt usando passphrase em secret `GMAIL_TOKEN_PASSPHRASE`)
- `access_token_encrypted` (text)
- `access_token_expires_at` (timestamptz)
- `scope` (text)
- `google_user_id` (text)
- `connected_at` (timestamptz)
- `last_error` (text, nullable)

Unique index por `(company_id)` (uma conta ativa por company). Funções `set_gmail_tokens(company_id, ...)` e `get_gmail_tokens(company_id)` SECURITY DEFINER análogas ao padrão `hook7_instance_token` já usado no projeto.

## Novas edge functions

- **`gmail-oauth-start`** (verify_jwt=true): recebe request do usuário autenticado, resolve `company_id`, gera `state` assinado (HMAC com `GMAIL_TOKEN_PASSPHRASE`) contendo `company_id + user_id + nonce + exp`, retorna `authorize_url` do Google com `access_type=offline`, `prompt=consent`, escopos completos.
- **`gmail-oauth-callback`** (verify_jwt=false, público): recebe `code + state`, valida HMAC/expiração do state, troca code por tokens no `oauth2.googleapis.com/token`, busca perfil em `gmail.googleapis.com/gmail/v1/users/me/profile`, faz upsert em `gmail_account` (com `refresh_token` criptografado), redireciona o usuário para `/settings/gmail?connected=1`.
- **`gmail-token-refresh`** helper interno (chamado pelas outras): dado `company_id`, retorna access_token válido; se expirado ou faltando, usa `refresh_token` para renovar e persiste.

## Refatorar funções existentes

`gmail-send`, `gmail-sync-inbox`, `inbound-webhook`, `referral-followup-cron`:
- Remover uso de `GOOGLE_MAIL_API_KEY` + `connector-gateway.lovable.dev/google_mail`
- Passar a exigir `company_id` no payload (ou derivar do contexto)
- Chamar `gmail-token-refresh` para obter access_token da company
- Trocar base URL para `https://gmail.googleapis.com/gmail/v1` com header `Authorization: Bearer <access_token>`
- Em 401, tentar refresh 1x; se ainda falhar, marcar `is_active=false` + `last_error` e sair
- `email` remetente vem de `gmail_account.email` da company (já existente)

## UI — `/settings/gmail`

Página já existe (mostra status/sync). Adicionar:
- Se não há `gmail_account` ativa para a company: card **"Conectar Gmail"** com botão que chama `gmail-oauth-start` e faz `window.location.href = authorize_url`
- Se conectado: mostrar email, `connected_at`, escopos, botão "Reconectar" (mesmo fluxo, força `prompt=consent`) e "Desconectar" (seta `is_active=false`, limpa tokens)
- Toast de sucesso quando volta com `?connected=1`
- Aviso amarelo se `last_error` presente

## Secrets a criar

- `GOOGLE_OAUTH_CLIENT_ID` (você fornece após configurar Google Cloud)
- `GOOGLE_OAUTH_CLIENT_SECRET` (idem)
- `GMAIL_TOKEN_PASSPHRASE` (gerado com generate_secret)

## Segurança

- Refresh tokens sempre criptografados no banco (pgp_sym_encrypt, mesmo padrão do `hook7_instances`)
- Access tokens de curta duração podem ficar em texto com `expires_at` (opcional criptografar também)
- RLS já filtra `gmail_account` por company (mig 20260702172430); usuário nunca vê o refresh_token via API — apenas o edge function via RPC SECURITY DEFINER
- `state` do OAuth assinado com HMAC + expira em 10 min para prevenir CSRF

## Migração da conta atual

O connector global `GOOGLE_MAIL_API_KEY` deixa de ser lido. A conta existente em `gmail_account` (se houver) continua na tabela mas sem tokens OAuth → envio falha até a company reconectar via OAuth. Um banner na página `/settings/gmail` avisa: *"Sua integração precisa ser reconectada usando OAuth do Google. Clique em Conectar Gmail."*

## Ordem de execução

1. Migration: adicionar colunas + funções RPC em `gmail_account`
2. Guiar o usuário no Google Cloud + registrar secrets (`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GMAIL_TOKEN_PASSPHRASE`)
3. Criar `gmail-oauth-start` e `gmail-oauth-callback`
4. Criar helper `gmail-token-refresh` (ou módulo compartilhado `_shared/gmail-auth.ts`)
5. Refatorar `gmail-send`, `gmail-sync-inbox`, `inbound-webhook`, `referral-followup-cron`
6. Atualizar UI `/settings/gmail` com botão Conectar/Reconectar/Desconectar
7. Testar fluxo end-to-end com uma company real