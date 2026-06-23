## Diagnóstico

Confirmei nos dados do lead Juliani que a última resposta foi enviada como nova thread:

- Primeiro email outbound: assunto `GroomerGenius: inovação para pets`, thread Gmail `19ef52350f60b518`.
- Resposta inbound do lead: assunto `Re: GroomerGenius: inovação para pets`, mesma thread `19ef52350f60b518`.
- Resposta do SDR: assunto `Continuando nossa conversa`, nova thread Gmail `19ef525df11a166f`, sem `In-Reply-To` e sem `References`.

O motivo provável é duplo:

1. O helper de thread busca a última mensagem com `.order("created_at")`, mas a tabela `messages` não tem coluna `created_at`; ela usa `sent_at`. Isso faz o contexto de reply falhar silenciosamente e voltar vazio.
2. Alguns caminhos ainda usam fallback com assunto `Continuando nossa conversa`, então quando o contexto falha o email sai como tópico novo.

## Plano de correção

1. Corrigir `supabase/functions/_shared/email-thread.ts`
   - Trocar a ordenação de `created_at` para `sent_at`.
   - Buscar a última mensagem de email da conversa com `rfc_message_id`.
   - Priorizar a última mensagem inbound para `In-Reply-To`, mantendo a cadeia `References` com os Message-IDs anteriores.
   - Reaproveitar o `gmail_thread_id` da thread existente.
   - Normalizar o assunto como `Re: <assunto original>` usando o primeiro/último assunto real da conversa.

2. Tornar o fallback de assunto mais seguro nos envios por Gmail
   - Remover o fallback operacional `Continuando nossa conversa` dos caminhos de resposta.
   - Se houver histórico de email, usar sempre `Re: <assunto da thread>`.
   - Só permitir assunto novo quando for realmente o primeiro email da conversa.

3. Ajustar os callers principais que enviam resposta SDR por email
   - `execute-action`: resposta live do SDR, callback, `send_email` e aprovações pendentes.
   - `approval-execute`: execução de mensagens aprovadas.
   - `cadence-agent-decide` e `cadence-executor`: manter o contexto já adicionado, mas agora funcionando com `sent_at`.
   - Revisar `inbound-webhook` para passar também `gmail_thread_id` quando usa `gmail-send` em auto-reply legado.

4. Evitar mensagem duplicada no banco
   - Revisar o `send_email` em `execute-action`, porque `gmail-send` já grava a mensagem outbound; não deve inserir uma segunda mensagem sem headers depois.

5. Deploy e validação
   - Deploy das edge functions alteradas.
   - Validar nos dados que próximas respostas terão:
     - mesmo `gmail_thread_id` da conversa original,
     - `In-Reply-To` preenchido,
     - `References` preenchido,
     - assunto `Re: GroomerGenius: inovação para pets` no caso da Juliani.

## Resultado esperado

A próxima resposta do SDR por email entrará como reply normal na conversa existente, com o conteúdo da troca anterior preservado pelo cliente de email, e não mais como nova mensagem com assunto `Continuando nossa conversa`.