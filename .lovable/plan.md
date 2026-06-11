## Diagnóstico

Em `/conversations` a Juju2 (só WhatsApp) usa o hook unificado `useLeadMessages` com queryKey `["lead-messages", ids]`. Quando o SDR envia uma resposta, `useSendMessage.onSuccess` invalida apenas `["messages", conversation_id]` — chave do hook antigo. A view unificada não recebe invalidação direta, dependendo só do realtime para atualizar.

Resultado: a mensagem entra no banco (confirmado: `direction=outbound` salvo em `messages`), mas o balão não aparece na UI até o evento de realtime chegar — e em casos onde o evento atrasa/falha, a mensagem some até refresh manual.

## Correção

### 1. `src/hooks/useConversations.ts` — `useSendMessage`
- Em `onSuccess`, invalidar também:
  - `["lead-messages"]` (partial match cobre qualquer agregação)
  - `["conversations", companyId]` (atualiza `lastActivity` na lista)
- Para isso, ler `companyId` via `useAuth()` dentro do hook.

### 2. `src/pages/Conversations.tsx` — feedback imediato
- Após `await sendMessage.mutateAsync(...)`, chamar `queryClient.invalidateQueries({ queryKey: ["lead-messages"] })` como reforço (defensivo, caso o hook seja reutilizado em outro lugar sem o fix).
- Manter o realtime como está (já invalida `["lead-messages"]`).

### 3. Verificação visual no replay
O replay também mostrou um flicker (balão aparece à esquerda e depois reposiciona à direita). Isso é consequência da chegada em duas etapas (insert otimista do realtime + refetch). Com o invalidate correto no `onSuccess` o refetch dispara antes do realtime na maioria dos casos, eliminando o flicker.

## Fora de escopo
- Sem mudanças de schema, edge functions, RLS ou realtime publication.
- Sem mexer em cadências, intents ou no webhook de inbound.

## Validação
1. Abrir chat da Juju2, digitar texto e enviar → balão aparece imediatamente do lado direito (SDR), sem precisar de F5.
2. Card da Juju2 na lista sobe para o topo com `lastActivity` atualizada.
3. Lead com WhatsApp+Email (Nico) continua intercalando mensagens corretamente após envio.
