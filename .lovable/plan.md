# WhatsApp (Twilio) + Inbox unificada

## O que já existe (não precisa refazer)
- `cadence-executor` já envia WhatsApp via Twilio gateway quando `step.channel = "whatsapp"` e há `TWILIO_API_KEY` + `TWILIO_WHATSAPP_NUMBER`.
- `inbound-webhook` já consegue **responder** por WhatsApp quando o canal da conversa é whatsapp.
- Cadências já permitem misturar steps de email e whatsapp (UI `CadenceStepCard` + select de canal).
- Email já entra na inbox via `gmail-sync-inbox` → `inbound-webhook`.

## O que falta (escopo deste plano)

### 1. Conectar Twilio
- Linkar o connector **Twilio** (gateway-enabled). Isso injeta `TWILIO_API_KEY` automaticamente.
- Adicionar secret `TWILIO_WHATSAPP_NUMBER`. Para o sandbox: `+14155238886`.
- Card no `settings/Integrations.tsx` para mostrar status "Conectado / Pendente" do WhatsApp e instruir o usuário a:
  - juntar o número do celular ao sandbox via código (`join <palavra>`);
  - configurar o webhook do sandbox apontando para a edge function (URL exibida pronta para copiar).

### 2. Receber respostas do WhatsApp — nova edge function `twilio-whatsapp-webhook`
- `verify_jwt = false`, recebe `application/x-www-form-urlencoded` do Twilio.
- Campos usados: `From` (ex.: `whatsapp:+5511...`), `Body`, `MessageSid`, `NumMedia`.
- Normalizar o telefone (remover `whatsapp:`), achar o `lead` por `phone` (multi-tenant: tentar match exato e variações de máscara/DDI).
- Encaminhar para `inbound-webhook` com `{ lead_id, content: Body, channel: "whatsapp" }` — mesmo pipeline do email, então toda a lógica de intents/IA/cadência se aplica igualzinho.
- Se não achar lead, retornar 200 + log (não falhar pro Twilio).

### 3. Inbox unificada por lead com flags de canal
Hoje `conversations` é por `(lead, channel)` — gera threads separadas para email e whatsapp do mesmo lead. Mudança:

- **Migração**: adicionar `messages.channel` (`email | whatsapp | linkedin | system`), backfill a partir de `conversations.channel`. Tornar `conversations.channel` opcional/"multi" (não dropar pra não quebrar histórico).
- **Backend**:
  - `cadence-executor` `findOrCreateConversation`: deixar de filtrar por `channel`, passa a ser **uma conversa por lead**. Inserir o `channel` real no `messages.channel`.
  - `inbound-webhook` (email e whatsapp) + `gmail-sync-inbox`: idem — reusar a conversa única do lead, preencher `messages.channel` conforme a origem.
  - Script de unificação: para leads com múltiplas conversas, manter a mais antiga, remapear `messages.conversation_id` das demais e apagar as órfãs.
- **Frontend `Conversations.tsx`**:
  - Lista lateral: 1 linha por lead (não por canal). Mostrar mini-badges dos canais já usados (✉ / 📱) e o canal da última mensagem.
  - Thread: cada bolha de mensagem ganha um ícone/badge do canal (Mail / MessageCircle) à esquerda do timestamp.
  - Composer: dropdown para escolher o canal do envio manual (default = canal da última mensagem recebida). Já existe envio por whatsapp no `inbound-webhook`; aqui é só uma chamada direta à função `twilio-whatsapp-send` (extraída) ou ao `gmail-send`.
  - Realtime (já implementado) continua funcionando — só muda o agrupamento.

### 4. Cadências mistas — ajuste pequeno
- O executor já trata os canais um a um. Adicionar validação na criação de step de whatsapp: avisar se `lead.phone` está vazio ao enrolar leads (warning na UI, não bloqueia).

## Fora de escopo
- Sair do sandbox / aprovar template Meta para envio fora da janela de 24h (depende de aprovação do Twilio, não dá pra automatizar).
- Mídia (imagem/áudio) entrando pelo WhatsApp — só texto nesta entrega.
- Migrar `conversations.channel` para enum novo "multi" (mantemos o campo como está pra compatibilidade).

## Ordem de execução
1. Conectar Twilio (connector) + pedir `TWILIO_WHATSAPP_NUMBER`.
2. Migração `messages.channel` + backfill + unificação de conversas por lead.
3. Criar `twilio-whatsapp-webhook` e atualizar `config.toml` (`verify_jwt = false`).
4. Ajustar `cadence-executor`, `inbound-webhook`, `gmail-sync-inbox` para usar conversa única + setar `messages.channel`.
5. Refatorar UI `Conversations.tsx` (lista por lead + badges de canal por mensagem + seletor de canal no envio).
6. Card de status Twilio em `settings/Integrations.tsx` com URL do webhook pronta pra copiar.

## Resultado
- Lead responde no WhatsApp → cai na mesma thread do email, com badge 📱 na bolha.
- Cadência mistura email e whatsapp normalmente.
- Você vê tudo em um só lugar e sabe de onde veio cada mensagem.
