## Como funciona a fila hoje

`src/hooks/useHumanInbox.ts` busca `conversations` com `human_takeover=true` da empresa e ordena por **`last_inbound_at desc`** (data da última mensagem recebida do lead). Já existe Realtime na fila (canal `inbox-realtime-*` escutando `conversations` e `INSERT` em `messages`) com fallback de `refetchInterval: 30s`.

Problemas atuais:
1. **A janela do chat aberto não atualiza em tempo real** — `useMessages` (em `useConversations.ts`) não tem subscription, então mensagens novas só aparecem ao trocar de conversa ou recarregar.
2. **`last_inbound_at` ignora mensagens outbound**, então a conversa não volta ao topo quando o operador responde — fica diferente do comportamento WhatsApp.
3. **Sem indicador de "não lido"** — não dá pra distinguir conversas que têm resposta nova do lead esperando.
4. **Sem aviso quando chega mensagem em outra conversa** que não está aberta.
5. **Sem auto-scroll** ao receber mensagem nova no chat aberto.

## Mudanças propostas

### 1. Realtime no chat aberto (`src/hooks/useConversations.ts`)
Adicionar dentro de `useMessages` um `useEffect` que assina `postgres_changes` em `messages` com `filter: conversation_id=eq.<id>` e invalida `["messages", conversationId]` em INSERT/UPDATE. Limpar o canal no unmount. (Tabela já está em `supabase_realtime`.)

### 2. Ordenação estilo WhatsApp (`useHumanInbox.ts`)
Trocar a chave de ordenação para **último timestamp de atividade** = `max(last_inbound_at, last_message.sent_at)`. Como a query já busca `last_message`, basta reordenar no client após o mapeamento. Resultado: ao responder, a conversa sobe ao topo.

### 3. Indicador de não-lido (`useHumanInbox.ts` + `Inbox.tsx`)
- Considerar **não-lida** uma conversa cujo `last_message.direction === "inbound"` e `sent_at > lastViewedAt[conversationId]` (armazenado em `localStorage` por usuário).
- Ao selecionar a conversa, marcar `lastViewedAt[id] = now()`.
- Na lista: nome em **bold**, ponto azul à direita e contagem no header (`X não lidas`).
- Adicionar terceiro filtro: **Todos / Meus / Não lidas**.

### 4. Aviso de mensagem nova em outra conversa (`Inbox.tsx`)
Quando um INSERT em `messages` de outra conversa da fila chegar (já capturado pelo canal da queue), disparar um `toast` discreto: "Nova mensagem de {nome}" com ação "Abrir" que troca o `selectedId`. Sem som por padrão (evita ser invasivo); pode ser adicionado depois se pedido.

### 5. Auto-scroll no chat (`Inbox.tsx > ChatPanel`)
Ref no fim da lista de mensagens; em `useEffect([messages.length])` chamar `scrollIntoView({ behavior: "smooth" })` — só rola se o usuário já estava perto do fim (evita pular enquanto lê histórico).

### 6. Pequenas melhorias visuais na lista
- Mostrar `formatDistanceToNow(latestActivityAt)` à direita do nome (substitui só onde fizer sentido junto do SLABadge).
- "SLA estourado" continua badge; conversas com SLA > 15min ganham um sutil destaque (borda esquerda âmbar) sem mudar a ordem (a ordem segue cronológica).

## Fora de escopo

- Persistir `last_read_at` em coluna de `conversations` (usar localStorage por enquanto é suficiente e não exige migração).
- Notificações do browser (`Notification` API) ou som.
- Atribuição / roteamento automático (round-robin entre operadores).
- Paginação da fila (volume atual cabe sem virtualização).

## Resultado

- O chat aberto recebe mensagens em tempo real (1ª prioridade).
- A fila se comporta como WhatsApp: última atividade no topo, não-lidas em negrito com contagem.
- Operador vê toast quando outro lead responde em uma conversa não aberta.