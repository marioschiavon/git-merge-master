## Diagnóstico

A ação `acknowledge_cancellation` foi processada às 13:00:16 e ficou como `done` com `result.sent = true`, mas não enviou mensagem porque entrou na fila com `conversation_id = null`.

No `execute-action`, o envio real depende de `conversation_id`. Quando ele vem nulo, `sendOutbound` retorna sem criar mensagem, porém o handler `acknowledge_cancellation` ignora esse retorno e marca a ação como enviada mesmo assim.

## Plano de correção

1. Ajustar o `calcom-webhook` para enfileirar `acknowledge_cancellation` já com a conversa correta do lead.
   - Reutilizar a conversa que o webhook já encontra/cria ao inserir a mensagem de sistema do cancelamento.
   - Se necessário, buscar a conversa mais recente do lead antes de inserir na fila.

2. Ajustar o `execute-action` para não declarar sucesso falso.
   - No handler `acknowledge_cancellation`, capturar o retorno de `sendOutbound`.
   - Se `sent = false`, lançar erro ou retornar status explícito para a fila não ficar como `done` indevidamente.
   - Aplicar o mesmo padrão nos handlers similares de agendamento que hoje retornam `{ sent: true }` sem validar o envio.

3. Melhorar fallback no executor.
   - Se a ação vier sem `conversation_id`, buscar/criar uma conversa pelo `lead_id` e `company_id` antes do envio.
   - Priorizar o canal da conversa mais recente; se não houver, usar WhatsApp quando o lead tiver WhatsApp.

4. Validar no banco e nos logs.
   - Confirmar que uma nova ação de cancelamento recebe `conversation_id`.
   - Confirmar que aparece uma mensagem outbound após o cancelamento.
   - Confirmar que a fila só fica `done` quando a mensagem realmente foi gravada/enviada.

## Fora do escopo

- Não alterar o texto/tom da mensagem do SDR.
- Não alterar regra de idempotência de 24h.
- Não alterar integração com Cal.com além do vínculo da conversa na fila.