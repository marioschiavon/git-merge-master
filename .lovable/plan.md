## Dois problemas

### 1. Emails de resposta do SDR vão sem formatação

O 1º email (cadência) é enviado por `cadence-executor`, que monta HTML com `\n → <br>`:
```ts
html: `<div ...>${parsed.message.replace(/\n/g, "<br>")}</div>`
```

Já as respostas automáticas do SDR são enviadas por `inbound-webhook` (linhas ~1491-1502), que só passa `text` para `gmail-send`. Dentro do `gmail-send`, o fallback é:
```ts
const finalHtml = html || `<p>${escapeHtml(text)}</p>`;
```
→ um único `<p>` com todo o conteúdo, sem quebra de linha → email visualmente "corrido", sem parágrafos.

**Correção:** em `inbound-webhook/index.ts` (chamada de auto-reply, ~linha 1491), passar `html` formatado igual ao cadence-executor:
```ts
html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(parsed.reply_message).replace(/\n/g, "<br>")}</div>`,
text: parsed.reply_message,
```
(precisa de um helper `escapeHtml` local, ou reaproveitar o que já existe em `gmail-send`.)

Bônus: aplicar o mesmo padrão na chamada de referral (~linha 1403), que também passa só `text`.

### 2. Página de Conversas não atualiza em tempo real

Hoje `useConversations` / `useMessages` só consultam via React Query no mount; não há subscription Realtime. Quando uma nova mensagem chega (inbound webhook ou auto-reply), o usuário precisa trocar de página para ver.

**Correção:**
1. Migração para habilitar Realtime nas tabelas relevantes:
   ```sql
   ALTER TABLE public.messages REPLICA IDENTITY FULL;
   ALTER TABLE public.conversations REPLICA IDENTITY FULL;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
   ```
2. Em `src/pages/Conversations.tsx` (ou diretamente nos hooks), adicionar `useEffect` com:
   - Canal `messages-changes` escutando `INSERT/UPDATE` em `public.messages` → `queryClient.invalidateQueries(["messages", conversationId])` quando o `conversation_id` do payload bater com o aberto, e sempre invalidar `["conversations"]` para atualizar o snippet/horário da lista.
   - Canal `conversations-changes` escutando `INSERT/UPDATE` em `public.conversations` filtrado por `company_id` → invalidar `["conversations", companyId]`.
   - Cleanup com `supabase.removeChannel(channel)` no unmount.

## Arquivos tocados

```text
supabase/functions/inbound-webhook/index.ts
  ├── helper escapeHtml local
  ├── chamada auto-reply: passar html (\n→<br>) além de text
  └── chamada referral email: idem

supabase/migrations/<timestamp>_realtime_conversations.sql
  └── REPLICA IDENTITY FULL + ADD TABLE em supabase_realtime para messages e conversations

src/pages/Conversations.tsx
  └── useEffect com subscriptions Realtime invalidando React Query
```

## Fora de escopo
- Mudar estilo/template do HTML do email além de quebra de linha.
- Reescrever a UI da página de conversas.
- Realtime em outras telas (Leads, Bookings).

## Resultado esperado
- Respostas do SDR por email chegam com parágrafos preservados, como o 1º email da cadência.
- Página `/conversations` mostra novas mensagens automaticamente, sem precisar trocar de tela.
