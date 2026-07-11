
## Problema

Os logs mostram `[hook7-webhook] evento desconhecido { event: "Message" }` — o webhook está descartando **todas** as mensagens recebidas do lead. A causa é um descasamento entre os nomes/estrutura dos eventos que o Hook7 realmente envia e os que nosso código espera.

O `hook7-webhook` atual foi escrito assumindo payload no estilo Evolution API cru (`event: "MESSAGE"`, `data.key.remoteJid`, `data.message.conversation`, `event: "CONNECTION"`), mas o Hook7 (que já roda em produção no **Leaderei Foundation**) envia:

- Eventos: `Message`, `Receipt`, `Connected`, `PairSuccess`, `LoggedOut`, `SendMessage`, `ChatPresence`
- Payload de mensagem: `data.Info.{ID, IsFromMe, Chat, Sender, SenderAlt, RecipientAlt, PushName, Timestamp, IsGroup}` e texto em `data.Message.conversation` ou `data.Message.extendedTextMessage.text`

Resultado: mensagens do lead nunca criam `messages` inbound → SDR nunca é acionado → cadência não avança na resposta.

## O que fazer

Reescrever a lógica de eventos do `supabase/functions/hook7-webhook/index.ts` seguindo o Foundation (`ab6c70f9-…/supabase/functions/hook7-webhook/index.ts`), adaptando ao schema deste projeto (`company_id`, colunas `messages.content/channel/provider/provider_message_id/direction`, `leads.phone / whatsapp`, `conversations`).

### 1. Switch de eventos (nomes corretos)

```text
Message       → handleMessage()   // grava inbound + dispara IA
Receipt       → handleReceipt()   // marca outbound como delivered/read
Connected     → handleConnected() // atualiza hook7_instances
PairSuccess   → handlePairSuccess()
LoggedOut     → handleLoggedOut()
SendMessage   → ignorar (Message com IsFromMe:true já cobre)
ChatPresence  → ignorar
default       → ignorar (log)
```

Manter o envelope de auth atual (secret na URL + `instanceId` + `instanceToken` conferidos com `loadInstanceToken`) e o retorno sempre 200.

### 2. `handleMessage` (o ponto principal do bug do usuário)

- Ler `data.Info`. Descartar quando `Info.IsGroup === true` ou `Chat` termina em `@g.us`, `@broadcast`, `@newsletter`, ou `status@broadcast`.
- Dedup por `Info.ID` via `messages.provider_message_id` (provider='hook7').
- Definir `isOutbound = Info.IsFromMe === true`. O "outro lado" é `RecipientAlt || Chat` no outbound, e `Sender || SenderAlt` no inbound. Extrair dígitos com `stripJid` (parte antes de `@` e de `:`).
- Extrair texto de `data.Message.conversation` ou `data.Message.extendedTextMessage.text`. Ignorar se vazio (mídia sem texto — fora do escopo desta correção).
- Localizar lead por telefone dentro da `company_id` da instância. Se não achar, **criar lead novo** com `phone`, `name = Info.PushName || '+<digits>'`, marcar `enrichment_status='not_queued'` para não disparar enrichment automaticamente, e sinalizar via metadata que veio de inbound WhatsApp desconhecido (para revisão manual — mesma ideia do `needs_review` do Foundation, usando os campos que existirem no schema atual).
- Achar/criar `conversations` (company_id, lead_id, channel='whatsapp').
- Inserir `messages`:
  ```
  { conversation_id, content: text, channel: 'whatsapp',
    direction: isOutbound ? 'outbound' : 'inbound',
    provider: 'hook7', provider_message_id: Info.ID,
    metadata: { hook7: { info: Info, instance_id } },
    sent_at: Info.Timestamp || now() }
  ```
- Se for `inbound`, encaminhar para `inbound-webhook` com `skip_insert: true` (como já está hoje) para acionar classify-intent / SDR / cadência.

### 3. `handleReceipt`

- Se `state`/`data.Type` for `read` ou `delivered`, dar update em `messages` (`direction='outbound'`, `provider='hook7'`, `provider_message_id in data.MessageIDs`) gravando o status dentro de `metadata.delivery_status` e `metadata.delivery_status_at` (nosso schema não tem coluna dedicada, então usamos metadata).

### 4. `handleConnected` / `handlePairSuccess` / `handleLoggedOut`

- Atualizar `hook7_instances` (`status`, `phone_number`, `connected_profile_name`, `last_connected_at`), respeitando uma janela de graça de 5 minutos se o usuário tiver desconectado manualmente. `LoggedOut` com `Reason=403` → `status='banned'`, `Reason>=500` → `status='error'`, caso contrário `disconnected`.

### 5. Filtro de grupo/broadcast

Extrair `stripJid()` e o teste `/@(g\.us|broadcast|newsletter)$/i` como helpers no topo do arquivo — igual Foundation.

### 6. Sem mudanças fora deste arquivo

- `_shared/hook7-whatsapp.ts` (outbound `/send/text`) já está ok.
- `_shared/hook7.ts`, `hook7-instance-manage`, `hook7-test-connection` não mudam.
- Não alteramos schema do banco — reaproveitamos `provider`, `provider_message_id`, `metadata`.
- `webhook_events` continua best-effort dentro de try/catch.

## Verificação

Após o build:
1. Enviar uma mensagem do próprio celular pareado para outro lead → deve aparecer como `outbound` (via evento `Message` com `IsFromMe:true`) sem duplicar o outbound do `send/text`.
2. Pedir ao lead para responder → conferir logs (`supabase--edge_function_logs hook7-webhook`) sem "evento desconhecido"; conferir no Supabase que a linha `messages` inbound foi criada e que `pending_inbound_runs` / SDR foi acionado.
3. Desconectar/reconectar a instância → conferir que `hook7_instances.status` reflete `connected`/`disconnected` corretamente.

## Detalhes técnicos

- Arquivo único alterado: `supabase/functions/hook7-webhook/index.ts` (reescrita completa dos handlers de evento, mantendo autenticação e path `/{secret}/{company-slug}`).
- Não altera contratos de outras funções nem tabelas — apenas passa a gravar `messages.provider='hook7'` no inbound (formato que o `send-outbound-message` já usa no outbound Hook7).
- Referência: projeto `Leaderei Foundation`, arquivo `supabase/functions/hook7-webhook/index.ts` (função `handleMessage` e cia).
