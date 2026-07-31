## Objetivo

Trocar o Nylas pelo **conector Gmail multi-tenant** da Lovable: um único cliente OAuth (seu), cada usuário faz o próprio consentimento e envia pelo próprio Gmail.

## Onde cada conexão fica

```text
Master Admin -> Gmail da plataforma   ->  caixa geral (fallback global), só master admin
Configurações -> Integrações          ->  "Meu Gmail" — admin da empresa e demais usuários
                                          conectam a própria caixa aqui
```

- O **admin master** conecta a caixa geral na tela de Master Admin.
- O **admin da empresa** e os **usuários** conectam suas contas em Configurações → Integrações — mesma tela, cada um vê e desconecta apenas a própria.
- A primeira caixa conectada da empresa vira a padrão de envio (`is_primary`), ajustável pelo admin da empresa na mesma tela.
- Configurações → Email deixa de hospedar conexão e fica só com o domínio legado.

## Plano de implementação

### 1. Conector
- Vincular o conector Gmail ao projeto (card em chat para escolher/criar o cliente OAuth).
- Escopos: `gmail.send`, `gmail.readonly`, `gmail.modify`, `userinfo.email`, `userinfo.profile`.
- No Google Cloud, registrar o redirect URI do gateway Lovable.

### 2. Conexão por usuário
- Reaproveitar `user_email_grants`: substituir `grant_id` do Nylas pela chave de conexão (`provider = 'gmail'`), sempre indexada pelo `user.id` autenticado; novas colunas `is_primary`, `is_platform`, `history_id`, `last_polled_at`.
- Funções `gmail-connect-start` / `gmail-connect-callback` gravam a conexão e o email/perfil. A chave nunca chega ao browser.
- `is_platform = true` só pode ser gravado por master admin; `is_primary` único por empresa.

### 3. Envio
- Helper `gmailSend` (MIME RFC822 base64url → `messages/send`) com `threadId` + `In-Reply-To`/`References` para manter a thread.
- Ordem de resolução em `send-outbound-email`: `email_grant_id` da cadência → caixa do dono da cadência → caixa `is_primary` da empresa → caixa da plataforma. Erro claro se nenhuma existir.
- `approval-execute`, `cadence-executor` e `cadence-agent-decide` seguem chamando a mesma função, sem mudança de contrato.

### 4. Recebimento (polling)
- `gmail-inbox-poll` em cron a cada 2 min: por conexão ativa usa `history.list` a partir do `history_id` salvo (fallback `messages.list` na primeira vez).
- Filtra só remetentes que são leads cadastrados, ignora enviados, dedupa por `gmail_message_id`.
- Reaproveita o pipeline atual: limpeza de HTML/citações, gravação em `messages`, `conversations.last_inbound_at` e disparo do agente SDR.

### 5. UI
- **Master Admin**: novo card "Gmail da plataforma" — conectar, status, último polling, desconectar.
- **Configurações → Integrações**: novo card "Meu Gmail" — conectar/desconectar a própria caixa, ver as caixas dos colegas em leitura, admin marca a padrão da empresa.
- `PersonalEmailCard` reaproveitado com prop de modo (`platform` | `personal`) e removido da tela de Email.

### 6. Remoção do Nylas
- Apagar `_shared/nylas.ts` e as funções `email-connect-start`, `email-connect-callback`, `email-disconnect`, `email-inbound-webhook`.
- Migração marcando grants Nylas existentes como `needs_reconnect` (reconexão em 1 clique) e limpando colunas específicas do Nylas.
- Remover referências e secrets órfãos do Nylas.

### Detalhes técnicos
- Todas as chamadas ao Gmail saem de Edge Functions via gateway — nenhum token Google no frontend.
- Limites: ~500 envios/dia (conta grátis) e 2.000 (Workspace); warm-up e caps diários atuais em `user_email_grants` continuam valendo.
- Outlook fica fora deste escopo; mesmo padrão se aplica depois com o conector Microsoft.

### Versão
`APP_VERSION` → `beta 0.23`.
