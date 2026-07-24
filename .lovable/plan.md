
# Migração Resend → Nylas (com coexistência) + Central de Warm-up

## Decisões confirmadas
1. **Single-tenant**: nossa conta Nylas, cliente só faz OAuth
2. **Escopo amplo**: Gmail, Outlook/Microsoft 365, **IMAP genérico**
3. **Coexistência**: Resend continua funcionando, Nylas entra ao lado
4. **Warm-up unificado**: nova tela cobrindo email + WhatsApp
5. **Plano Nylas Free** (5 contas totais no piloto)
6. **White-label**: usuário final NÃO vê "Nylas". Chamamos de "Meu email" / "Conectar meu email". Nota de rodapé pequena tipo `Integração via Nylas` só na tela de conexão para transparência
7. **Filtro estrito inbound**: agente SDR só processa emails vindos de endereços que já são leads da empresa. **Emails de fora são totalmente ignorados pelo app** — não geram conversa, não aparecem em lugar nenhum do Leaderei. Continuam existindo apenas na caixa de entrada real do usuário (Gmail/Outlook), fora do app

---

## Impacto do limite de 5 contas (free tier)
- Guardrail no OAuth start conta grants ativos; ≥5 retorna erro
- Master admin vê `X/5 slots` em `/master/platform-settings`
- Cliente que desconecta libera slot

---

## Fase 1 — Fundação (coexistência)

### 1.1 Setup fora do código (você)
- Criar conta Nylas free, connectors Google/Microsoft/IMAP
- OAuth apps no Google Cloud + Azure com redirect URI da Nylas
- Secrets no Lovable Cloud: `NYLAS_CLIENT_ID`, `NYLAS_API_KEY`, `NYLAS_API_URI`, `NYLAS_WEBHOOK_SECRET`

### 1.2 Nova tabela `user_email_grants`
```text
id, user_id, company_id
provider ('google' | 'microsoft' | 'imap')
grant_id, email, display_name, status
daily_sent_count, warmup_started_at
scopes, last_error, created_at, updated_at
UNIQUE(user_id, email)
```
RLS: user vê próprios, company_members veem os da empresa (read), master vê todos.

### 1.3 Novas edge functions
- `email-connect-start` — checa cap 5 → gera URL OAuth
- `email-connect-callback` — troca code por grant_id
- `email-disconnect` — revoga grant
- `email-inbound-webhook` — recebe `message.created`, **filtra por lead**, roteia
- `email-send` — helper de envio

### 1.4 Filtro inbound estrito (CRÍTICO — corrigido)
Fluxo em `email-inbound-webhook`:
1. Recebe webhook do provider e valida HMAC
2. Resolve `company_id` via `grant_id` → `user_email_grants`
3. Extrai `from_email` do remetente
4. Query: `SELECT id FROM leads WHERE lower(email) = lower(?) AND company_id = ?`
5. **Se lead NÃO encontrado**: retorna HTTP 200 imediatamente. Nada é gravado. Nada aparece no app. Log opcional só em nível debug (não em `audit_logs`, não em `messages`, não em `conversations`). O email continua existindo apenas na inbox real do usuário (Gmail/Outlook)
6. **Se lead encontrado**: cria/atualiza `conversations` do lead, insere `messages` inbound, dispara pipeline do agente SDR normalmente
7. Bounces/auto-replies (`Auto-Submitted`, `List-Id`, DSN 5xx): ignorados mesmo se vierem de um lead — vão pra `suppressed_emails`

**Sem toggle**: comportamento é fixo. Zero configuração pro cliente, zero ruído no app.

### 1.5 Frontend `/settings/email`
- Nova seção **"Meu email"** com botões "Conectar Gmail", "Conectar Outlook", "Conectar outro (IMAP)"
- Lista de contas conectadas do usuário, status, botão Desconectar
- Aviso curto: `Apenas emails de leads cadastrados aparecem no Leaderei. Emails de outros remetentes ficam somente na sua caixa de entrada.`
- Nota de rodapé pequena: `Integração de email via Nylas`
- Aba antiga Resend intacta

### 1.6 Master admin `/master/platform-settings`
- Card **"Slots de email conectado (X/5)"** — lista todos os grants com email/empresa/usuário, botão desconectar

---

## Fase 2 — Roteamento de envio

### 2.1 Campo em cadência
`cadences.email_channel` ∈ `'domain' | 'personal'`  
- `domain` = envio pelo domínio da empresa (Resend, comportamento atual, default)
- `personal` = envio pela conta de email conectada do dono
UI: "Enviar do domínio da empresa" / "Enviar do meu email conectado"

### 2.2 Adaptar `send-outbound-email`
- Se `personal`: resolve grant do dono → `POST /v3/grants/{id}/messages/send` no Nylas
- Threading nativo via `reply_to_message_id`
- Se `domain`: caminho Resend atual sem mudança
- `messages.email_provider` = `'nylas' | 'resend'`

### 2.3 Guardrails
- Cadência `personal` sem grant ativo → bloqueia lançamento com toast + link "Conectar meu email"
- Cadence-executor cria approval "Reconecte seu email" se grant expirar no meio do fluxo

---

## Fase 3 — Central de Warm-up

### 3.1 Nova rota `/settings/warmup`
Card por canal ativo (contas de email + instâncias WhatsApp):

```text
┌─ Gmail — vendas@empresa.com ────────────────┐
│  Dia 5 de warm-up  ▓▓▓▓▓░░░░░ 50%           │
│  Hoje: 42 / 60 enviados                     │
│  Cap atual: 60/dia (limite Gmail: 500)      │
│  Próximo aumento: amanhã → 80/dia           │
│  [Ver histórico 30d]  [Pausar warm-up]      │
└─────────────────────────────────────────────┘
```

Métricas: dia do warm-up, cap atual, % consumido, enviados/entregues/bounces/reclamações 7d, taxa de resposta, próximo cap.

### 3.2 Rampas conservadoras (email)
| Dia | Cap diário | Cap horário |
|-----|-----------|-------------|
| 1-2 | 20 | 5 |
| 3-5 | 40 | 8 |
| 6-10 | 80 | 15 |
| 11-15 | 150 | 25 |
| 16-21 | 250 | 40 |
| 22+ | 400 | 60 |

WhatsApp: refatorar `warmupCaps` existente em `whatsapp-send-tick` e expor na UI.

### 3.3 Enforcement
- `send-outbound-email` (path Nylas) consulta `warmup_started_at` + count do dia
- Cap atingido: reenfileira pro dia seguinte + log

### 3.4 Doc `docs/boas-praticas-email.md`
Warm-up, personalização, evitar links/imagens excessivas, resposta rápida, descadastro.

---

## Fase 4 — Migração e deprecação (30+ dias)

- Migrar cadências ativas por opt-in
- Marcar Resend como "legado" na UI
- Após saída: remover `resend-*`, `company_email_domains`, `resend-inbound-webhook`
- Cancelar plano Resend

---

## Detalhes técnicos

**Nylas API** (interno, não exposto ao usuário):
- OAuth: `GET /v3/connect/auth` + `POST /v3/connect/token`
- Envio: `POST /v3/grants/{grant_id}/messages/send`
- Webhook `message.created`: HMAC-SHA256 via `X-Nylas-Signature`
- Setup webhook via `POST /v3/webhooks`

**Escopos:**
- Google: `gmail.send`, `gmail.readonly`, `gmail.modify`, `openid`, `email`, `profile`
- Microsoft: `Mail.ReadWrite`, `Mail.Send`, `offline_access`
- IMAP: form host/port/user/senha

**Ordem de implementação:**
1. Setup Nylas + secrets (você)
2. Tabela `user_email_grants` + RLS
3. Edge functions `email-connect-*` + UI + guardrail 5 slots
4. `email-inbound-webhook` **com filtro estrito por lead**
5. `email_channel` em cadências + `send-outbound-email`
6. `/settings/warmup` com enforcement
7. Master admin slots
8. Doc boas práticas

Bump: `beta 0.11` fase 1, +0.1 por fase.

---

## Antes de começar
Confirma: você já criou a conta Nylas free ou quer o passo-a-passo do dashboard primeiro?
