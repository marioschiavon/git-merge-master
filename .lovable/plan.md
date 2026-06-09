# Integração Twilio WhatsApp — Credenciais por Empresa

## Objetivo
Permitir que cada empresa configure suas próprias credenciais Twilio (Account SID, Auth Token, número do sandbox/produção) para enviar e receber mensagens de WhatsApp, mantendo o inbox unificado com email.

## Decisão de arquitetura: credenciais por empresa

Como o sistema é multi-tenant, **secrets globais não servem** — cada empresa precisa do seu próprio número/conta Twilio. Em vez de secrets do Lovable (que são globais), as credenciais ficarão armazenadas **criptografadas na tabela `integrations`** (já existe), uma linha por empresa do tipo `twilio_whatsapp`.

## Passos

### 1. Schema — armazenar credenciais por empresa
Usar a tabela `integrations` existente com:
- `provider = 'twilio_whatsapp'`
- `config` (jsonb) contendo: `account_sid`, `auth_token`, `whatsapp_number` (ex: `+14155238886` do sandbox), `is_sandbox` (boolean)
- RLS já garante isolamento por `company_id`

Migration apenas se precisar adicionar índice único `(company_id, provider)`.

### 2. UI de configuração — `settings/Integrations.tsx`
Novo card "WhatsApp (Twilio)" com:
- Campos: Account SID, Auth Token (masked), Número WhatsApp, checkbox "Sandbox"
- Botão "Testar conexão" → chama edge function `twilio-test-connection` que faz uma requisição `GET /Accounts/{sid}.json` para validar
- Botão "Salvar" → upsert na tabela `integrations`
- Exibir URL do webhook que o usuário deve colar no console Twilio:
  `https://<project>.supabase.co/functions/v1/twilio-whatsapp-webhook`
- Instruções passo-a-passo para o sandbox (enviar `join <code>` para `+14155238886`)

### 3. Edge function `twilio-whatsapp-webhook` (inbound)
- Público (sem JWT), recebe `application/x-www-form-urlencoded` do Twilio
- Identifica a empresa pelo `To` (número WhatsApp recebedor) → busca `integrations` com aquele número
- Normaliza `From` (remove `whatsapp:`), encontra lead por telefone dentro da empresa
- Reaproveita pipeline do `inbound-webhook` (cria/atualiza conversa, mensagem com `channel='whatsapp'`)

### 4. Edge function `twilio-send-whatsapp` (outbound) + refatorar `cadence-executor`
- Recebe `{ lead_id, content }`
- Busca credenciais da empresa do lead na tabela `integrations`
- Chama Twilio REST API diretamente (HTTP Basic Auth com SID:Token) — **não usa gateway**, pois credenciais são da empresa:
  ```
  POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
  ```
- `cadence-executor` passa a chamar essa função em vez do gateway Lovable para steps `whatsapp`

### 5. Inbox unificado (do plano anterior, mantido)
- Coluna `messages.channel` (email | whatsapp)
- Uma conversa por lead, badges de canal nas mensagens
- Composer com seletor de canal

## Detalhes técnicos

**Segurança do auth_token:**
- Armazenado em `config` jsonb na tabela `integrations`
- RLS restringe leitura a admins da empresa
- Edge functions usam `service_role` para ler quando precisam enviar/receber

**Roteamento inbound multi-tenant:**
- Twilio envia o campo `To` (número que recebeu a mensagem)
- Lookup: `SELECT company_id FROM integrations WHERE provider='twilio_whatsapp' AND config->>'whatsapp_number' = $1`
- Se duas empresas usarem o mesmo sandbox `+14155238886`, é preciso desambiguar pelo prefixo `join code` ou exigir números distintos (em produção cada uma terá seu próprio número)

**Limitação do sandbox compartilhado:**
- O sandbox Twilio usa um único número global. Para multi-tenant real, recomenda-se que cada empresa tenha sua própria subconta Twilio ou número dedicado em produção.
- Aviso explícito na UI: "Sandbox compartilhado — em produção, contrate um número dedicado"

## Fora do escopo
- Aprovação de templates Meta (produção)
- Mídia (imagem/áudio) via WhatsApp — apenas texto nesta fase
- Migração para subcontas Twilio automáticas

## Resultado esperado
Cada empresa configura suas credenciais Twilio em Settings → Integrations, testa a conexão, cola a URL do webhook no console Twilio, e passa a enviar/receber WhatsApp pelo próprio número, com tudo aparecendo no inbox unificado junto com email.
