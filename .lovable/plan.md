## Problema

Nas respostas de email pelo Nylas estão ocorrendo dois defeitos:

1. **Mensagem inbound duplicada + IA responde duas vezes.** O `email-inbound-webhook` insere a mensagem em `messages` e depois chama `inbound-webhook` **sem** `skip_insert:true` e **sem** `provider`/`provider_message_id`. O `inbound-webhook` então insere a mesma mensagem de novo (não tem chave de deduplicação para pular), e cada retry do Nylas dispara o pipeline inteiro de novo — gerando 2 respostas da IA.
2. **Fallback do approval-execute cria "conversa nova" com as respostas da IA.** Quando a aprovação é `sdr_reply` avulsa (sem enrollment) e cai no fallback para email pessoal (Nylas), `approval.conversation_id` às vezes vem nulo e o `send-outbound-email` acaba criando uma conversa nova em vez de aproveitar a conversa de email já existente do lead.

## Correções

### 1. `supabase/functions/email-inbound-webhook/index.ts`
- Antes de inserir em `messages`, checar se já existe uma mensagem com `metadata->>nylas_message_id = msg.id` para a mesma conversa; se sim, responder `200 { deduped: true }` e sair (evita duplicar em retries do Nylas).
- Ao chamar `inbound-webhook`, passar:
  - `skip_insert: true` (a mensagem já foi persistida aqui)
  - `provider: "nylas"`
  - `provider_message_id: msg.id`
  - manter `conversation_id`, `lead_id`, `text`, `source: "email"`

### 2. `supabase/functions/approval-execute/index.ts`
- Antes de invocar `send-outbound-email` no ramo `sdr_reply`/`sensitive_action` com canal email, se `approval.conversation_id` estiver nulo, buscar a conversa existente do lead (`lead_id = approval.lead_id`, `channel = "email"`, mais recente) e usá-la como `conversation_id`. Assim o fallback via Nylas reusa a thread e não cria conversa órfã.

### 3. `supabase/functions/send-outbound-email/index.ts` (guarda extra)
- Na ramificação Nylas (`email_channel === "personal"`), trocar o `.maybeSingle()` que procura conversa por `lead_id + channel=email` por `.order("created_at",{ascending:false}).limit(1).maybeSingle()` para não estourar caso haja mais de uma e cair no `insert` (mesma correção que o ramo Resend já tem parcialmente). Só cria conversa nova se realmente não existir nenhuma.

### 4. Bump de versão
- `src/lib/version.ts` → `beta 0.19`.

## Fora de escopo
- Não mexer no `inbound-webhook` em si nem em quem monta os approvals; as três mudanças acima já quebram a cadeia de duplicação e o fallback órfão.
