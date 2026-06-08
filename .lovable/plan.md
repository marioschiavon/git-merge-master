## Problema

Dois bugs no fluxo de respostas recebidas por **Gmail Sync** (`gmail-sync-inbox`):

1. **Texto citado não é removido** — a mensagem é salva com o histórico completo (`> Prezado(a) Juliano...` etc), poluindo a conversa.
2. **IA não responde** — `gmail-sync-inbox` só insere a mensagem em `messages` e nunca invoca `inbound-webhook`, que é quem roda a análise da IA, agenda, pausa cadência, etc.

(O fluxo via `inbound-email-webhook` — webhook direto Mailgun — já faz strip + invoca `inbound-webhook`. O problema é só no caminho Gmail.)

## Solução

### 1. Compartilhar a função de strip

Extrair `stripQuotedEmail` (hoje duplicada em `inbound-webhook` e `inbound-email-webhook`) para `supabase/functions/_shared/strip-quoted-email.ts` e importar nos 3 lugares (inclusive no novo uso em `gmail-sync-inbox`).

### 2. `gmail-sync-inbox`

Após extrair `body`:
- Aplicar `stripQuotedEmail(body)` antes de salvar.
- Salvar a mensagem como já faz (mantendo `gmail_message_id`, `gmail_thread_id`, `rfc_message_id`, metadata).
- Em seguida, invocar `inbound-webhook` passando `{ conversation_id, content: cleanBody, channel: "email", skip_insert: true }` para acionar análise da IA, gestão de slots e cadência — **sem** duplicar a inserção.

### 3. `inbound-webhook`

Adicionar suporte ao parâmetro `skip_insert`: quando `true`, pula apenas o `insert` em `messages` (a mensagem já está salva pelo gmail-sync com metadata correta) e segue normalmente com o restante do fluxo (pausa enrollment, análise IA, reply, schedule, etc).

### 4. Reforçar o strip

O padrão atual procura `\n\s*Em\s...escreveu:` mas o texto vindo do Gmail às vezes tem a citação começando na primeira linha após uma linha em branco que pode estar ausente. Ajustar a regex para também aceitar `Em ... escreveu:` no início de linha sem newline anterior obrigatório (usar `^|\n`), garantindo que o exemplo do print (`Em seg, 8 de jun. de 2026, 09:30, <flatmardecampas@gmail.com> escreveu:`) seja cortado.

## Arquivos alterados

- `supabase/functions/_shared/strip-quoted-email.ts` (novo)
- `supabase/functions/inbound-webhook/index.ts` (importa shared + suporta `skip_insert`)
- `supabase/functions/inbound-email-webhook/index.ts` (importa shared)
- `supabase/functions/gmail-sync-inbox/index.ts` (strip + invoca inbound-webhook)

## Fora do escopo

- Mudar o parser MIME do Gmail (`extractBody`).
- Alterar o prompt da IA.
- Mudar lógica de matching de conversa por thread.
