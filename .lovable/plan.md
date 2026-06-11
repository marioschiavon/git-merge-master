## Objetivo

Em `/conversations`, quando um lead tiver mais de uma `conversation` (ex.: WhatsApp + Email), exibir uma única linha por lead na lista e uma única thread no detalhe, intercalando todas as mensagens em ordem cronológica e mostrando o canal de cada uma. O schema do banco fica inalterado — a unificação acontece só no frontend.

## Mudanças

### 1. Lista de conversas (`src/pages/Conversations.tsx`)
- Agrupar `conversations` por `lead_id` no client.
- Cada card mostra: nome do lead, empresa, email, badges com os canais ativos (ex.: `whatsapp`, `email`) e data da última atividade do grupo.
- Selecionar o card passa a definir um `selectedLeadId` (em vez de `selectedConvId`) com a lista de `conversation.id` daquele lead.

### 2. Hook de mensagens unificadas (`src/hooks/useConversations.ts`)
- Novo hook `useLeadMessages(conversationIds: string[])`:
  - `select("*", { conversation_id IN (...) })` ordenado por `sent_at asc`.
  - Anexa `channel` em cada mensagem via lookup local pelas conversations do lead (para renderizar o badge no balão).
- Mantém `useMessages` para retrocompatibilidade.

### 3. Detalhe da conversa unificada
- Header: nome do lead + chips dos canais disponíveis.
- Lista de mensagens intercalada (uma só timeline). Cada balão ganha um badge pequeno (`WhatsApp` / `Email`) ao lado do "SDR/Prospect".
- `BookingCard` e `SlotHoldsCard` continuam por `lead_id` (já é o caso).

### 4. Envio outbound (regra de canal)
- Calcular `replyChannel` = canal da mensagem **inbound** mais recente do lead; fallback: canal da conversa mais antiga.
- Resolver `conversation_id` para envio = a conversation do lead cujo `channel === replyChannel`.
- Mostrar acima do input: "Respondendo via **{canal}**" (informativo, sem seletor).
- `useSendMessage` segue como está — só muda qual `conversation_id` é passado.

### 5. Realtime
- O subscribe atual em `messages` já invalida por `conversation_id`. Adicionar invalidação adicional da query agregada `["lead-messages", leadId]` quando o `conversation_id` recebido pertence a alguma conversation do lead aberto.

### 6. Sugestão IA
- `useAiReply` recebe o histórico unificado e o `channel` = `replyChannel` (para o prompt gerar resposta no tom certo do canal).

## Fora de escopo
- Nenhuma alteração de schema, migração ou edge function.
- Não mexe em cadências, roteamento de intents nem `inbound-webhook`.
- Conversa única no banco (1 row por lead) fica para outro momento.

## Validação
- Lead com só 1 canal: comportamento idêntico ao atual.
- Lead Nico (WhatsApp + Email): aparece 1 card; abrir mostra mensagens intercaladas com badges de canal; responder envia pelo canal da última mensagem inbound do lead.
