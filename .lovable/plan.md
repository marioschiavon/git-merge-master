
# Threading correto nos emails de saída

## Diagnóstico

Cada envio de email pelas ações (`execute-action`, `approval-execute`, feedback pós-reunião) cria um **tópico novo** no Gmail do lead por dois motivos somados:

1. **Subject sempre novo.** Os callers passam literalmente `subject || "Continuando nossa conversa"`, descartando o assunto da conversa original. Gmail agrupa thread por `References`/`In-Reply-To` **ou** por assunto idêntico — perdendo os dois, vira tópico novo.
2. **Headers de reply ausentes.** O `gmail-send` já aceita `in_reply_to_rfc_id` e `references` (e até gera os headers corretos), mas **nenhum caller passa esses campos**. A função tem o suporte; quem chama nunca usou.
3. **`threadId` do Gmail não é enviado.** O jeito mais confiável de threading no Gmail API é incluir `threadId` no payload `messages.send`. Hoje o `gmail-send` só manda `{ raw }`, então mesmo com headers corretos o Gmail às vezes não agrupa.

A função `gmail-sync-inbox` já guarda `gmail_thread_id` e `rfc_message_id` em cada `messages`, então a informação necessária para responder dentro da thread **já existe no banco** — só não está sendo lida na hora de enviar.

## O que vai ser feito

### 1. Helper compartilhado `_shared/email-thread.ts`
Nova função `getEmailReplyContext(supabase, conversation_id)` que retorna:
```ts
{
  in_reply_to_rfc_id: string | null,   // rfc_message_id da última msg da thread
  references: string | null,            // cadeia acumulada (References anterior + última)
  gmail_thread_id: string | null,       // para passar ao Gmail API
  reply_subject: string | null,         // "Re: <assunto original>" (sem duplicar "Re:")
}
```
Lógica: pega a **mensagem mais recente** da conversa (`order by created_at desc limit 1`) com canal email que tenha `rfc_message_id`. Usa `metadata.subject` ou, se vier de inbound, o subject parseado. Garante prefixo `Re: ` único.

### 2. `gmail-send` — aceitar e propagar `gmail_thread_id`
- Novo campo opcional no body: `gmail_thread_id`.
- Incluir no payload do Gmail API: `JSON.stringify({ raw, threadId: gmail_thread_id })` quando presente.
- Sem mudar nada quando ausente (primeira mensagem da thread).

### 3. Callers que enviam email passam a usar o contexto

**`execute-action/index.ts`** (linhas 154–164, 320–329, 489–517):
- Antes de chamar `gmail-send`, se `conversation_id` existe, busca `getEmailReplyContext`.
- Passa `in_reply_to_rfc_id`, `references`, `gmail_thread_id`.
- Subject:
  - Usa `reply_subject` do contexto se houver thread anterior.
  - Senão usa o subject vindo da decisão / generator.
  - Só cai em `"Continuando nossa conversa"` se for genuinamente a primeira mensagem (sem conversa anterior e sem subject gerado).

**`approval-execute/index.ts`** (linha 178): mesma mudança, mesmo helper.

**`execute-action/index.ts` linha 1043** (request_feedback pós-reunião): mantém comportamento atual (é intencionalmente um tópico novo de pesquisa de satisfação) — **não** alterar.

### 4. Sem migração de banco
Tudo que precisamos (`rfc_message_id`, `gmail_thread_id`, `metadata.subject`) já está em `messages`. Nada a mudar no schema.

## Comportamento resultante

| Cenário | Hoje | Depois |
|---|---|---|
| Primeira mensagem de cadência por email | Subject definido pela cadência. Tópico novo (correto). | Igual. |
| Lead responde, agente manda follow-up | Tópico novo "Continuando nossa conversa" | Mesmo tópico, subject "Re: <original>", aparece como reply no Gmail |
| Operador aprova mensagem no HITL e envia | Tópico novo | Mesma thread |
| Pesquisa pós-reunião | Tópico próprio | Mantém tópico próprio (intencional) |

## Testes manuais sugeridos após implementar
1. Criar cadência por email → enviar 1ª mensagem → ver no Gmail do lead.
2. Lead responde manualmente.
3. Agente decide enviar follow-up → deve aparecer **dentro** do mesmo tópico, com "Re: ".
4. Acionar HITL, aprovar uma reply → mesma thread.
5. Verificar em `messages` que `gmail_thread_id` é o mesmo das outras mensagens da conversa.

## Arquivos a alterar
- `supabase/functions/_shared/email-thread.ts` (novo)
- `supabase/functions/gmail-send/index.ts`
- `supabase/functions/execute-action/index.ts`
- `supabase/functions/approval-execute/index.ts`

Sem mudanças de UI, sem migração, sem novos secrets.
