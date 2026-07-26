## Problema confirmado

Conferi no banco a conversa do Mario (S7) e há dois bugs que se combinam:

1. **A conta Nylas conectada (`mariors07@gmail.com`) também está cadastrada como lead** (Mario R Schiavon). Toda vez que enviamos um email por Nylas para `mario@s7.dev.br`, o Google entrega uma cópia no Sent do próprio `mariors07@gmail.com`, e a Nylas dispara `message.created` para essa cópia. O `email-inbound-webhook` faz um `SELECT lead WHERE email = from_email` (o from é o próprio grant), acha o "lead" Mario R Schiavon e cria uma **conversa fantasma** com nossos próprios outbounds como se fossem inbounds.

2. **Duplicação dentro da conversa correta**: para cada resposta real do `mario@s7.dev.br` aparecem 2 linhas — uma com `nylas_message_id` + `from_email` preenchidos (inserida pelo `email-inbound-webhook`) e outra com `from_email = NULL` inserida logo depois. O `email-inbound-webhook` chama `inbound-webhook` com `skip_insert: true`, mas o `inbound-webhook` está ignorando essa flag em algum caminho e reinserindo a mensagem.

## Correções propostas

### 1. `supabase/functions/email-inbound-webhook/index.ts` — ignorar eventos do próprio grant

Antes do lookup de lead, comparar `fromEmail` com `grantRow.email` (case-insensitive). Se forem iguais, retornar `200 ok, self-echo ignored` sem tocar em `conversations` nem em `messages`. Isso mata a conversa fantasma criada com o email do Nylas e evita registrar nossos próprios outbounds como inbound.

Reforço extra: também ignorar quando o header `X-Gm-Message-State`/`X-Sent`/pasta `SENT` indicar sent (quando disponível em `msg.folders`/`msg.labels`). O check por `fromEmail === grant.email` já cobre 100% dos casos do Google, então esse é opcional.

### 2. `supabase/functions/inbound-webhook/index.ts` — respeitar `skip_insert` de verdade

Auditar todos os caminhos que fazem `messages.insert` com `direction: 'inbound'` e envolvê-los em `if (!skip_insert) { ... }`. Hoje o código lê `skip_insert` no topo mas ainda existe pelo menos um path (provavelmente na normalização de conteúdo/`content` antes da IA) que insere a mensagem novamente — é ele o responsável pelas linhas com `from_email = NULL` logo após cada inbound com `nylas_message_id`.

Também vou garantir que quando `skip_insert` for verdade, o payload passe direto para a etapa da IA usando o `message_id` já recebido, sem criar uma nova linha "espelho".

### 3. Limpeza pontual dos dados atuais do teste

Uma vez que as correções estejam ativas, apagar (do lead `mariors07@gmail.com` = 358b199a…):
- A conversa fantasma criada com o email do grant (id `9809f772-1b2c-46bb-9a94-743413bbbf9c`) e todas as mensagens associadas.
- As `approval_requests` pendentes vinculadas a essa conversa.

Isso deixa apenas a conversa correta (`mario@s7.dev.br`) no estado esperado. Nada disso muda schema — só edge functions e um cleanup pontual.

### Fora de escopo

- Não vou remover o lead `mariors07@gmail.com` automaticamente (é possível que você tenha criado de propósito). Se quiser, faço isso junto no cleanup.
- Não vou mexer no `approval-execute` nem no `send-outbound-email` — a origem do problema é o webhook.

## Bump de versão

`APP_VERSION` sobe para `beta 0.21` depois da implementação.
