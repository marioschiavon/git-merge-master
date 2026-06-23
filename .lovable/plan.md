## Problema

A correção anterior só foi aplicada em `execute-action` e `approval-execute`. Mas as respostas do SDR de cadência são enviadas por outros dois callers que **não** usam `getEmailReplyContext` — por isso continuam abrindo tópico novo com "Continuando nossa conversa".

Callers faltantes:
- `supabase/functions/cadence-agent-decide/index.ts` (linha ~656) — caminho do SDR Agent decidindo follow-up de cadência.
- `supabase/functions/cadence-executor/index.ts` (linhas ~277 e ~557) — executor de steps de cadência (mensagem custom aprovada e auto-gerada).

Nenhum dos três passa `in_reply_to_rfc_id`, `references`, `gmail_thread_id` nem usa `reply_subject`, então o Gmail abre tópico novo.

## O que vai ser feito

Aplicar exatamente o mesmo padrão já validado em `execute-action`:

### 1. `cadence-agent-decide/index.ts`
- Importar `getEmailReplyContext` de `../_shared/email-thread.ts`.
- No bloco de email (linha ~654), antes de invocar `gmail-send`:
  - `const threadCtx = await getEmailReplyContext(supabase, conversation?.id);`
  - Passar no body: `subject: threadCtx.reply_subject || decision.subject || \`Mensagem para ${lead.name}\``, `in_reply_to_rfc_id: threadCtx.in_reply_to_rfc_id`, `references: threadCtx.references`, `gmail_thread_id: threadCtx.gmail_thread_id`.

### 2. `cadence-executor/index.ts`
Mesma mudança nos **dois** sites de email:
- Linha ~277 (mensagem custom aprovada): usar `preConversation?.id` para buscar contexto e passar os campos.
- Linha ~557 (mensagem auto-gerada): usar `preConversationAi?.id` para buscar contexto e passar os campos.
- Subject mantém fallback `parsed.subject || \`Mensagem para ${lead.name}\`` se não houver thread anterior.

### 3. Sem mudanças adicionais
- `_shared/email-thread.ts` já existe e funciona.
- `gmail-send` já aceita e propaga `gmail_thread_id` / headers (não muda).
- Sem migração, sem mudança de UI, sem secrets novos.

## Comportamento esperado depois

- **Primeira mensagem da cadência por email:** assunto da cadência, tópico novo (correto).
- **Follow-up do SDR após resposta do lead:** mesma thread no Gmail, subject "Re: <original>", headers `In-Reply-To` + `References` corretos, `threadId` reaproveitado.
- **Step executado pelo cadence-executor depois que a thread já existe:** também responde dentro da thread.

## Arquivos a alterar
- `supabase/functions/cadence-agent-decide/index.ts`
- `supabase/functions/cadence-executor/index.ts`

Deploy das duas edge functions após as edições.