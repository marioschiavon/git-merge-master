**Diagnóstico**
- O webhook já reconhece o cancelamento pelo link público como cancelamento do lead.
- O problema atual está no banco: a ação `acknowledge_cancellation` não existe no enum `action_type`.
- Por isso, o webhook tenta enfileirar a ação, mas falha com: `invalid input value for enum action_type: "acknowledge_cancellation"`.
- Como nada entra em `lead_action_queue`, o executor nunca chama o handler que envia a mensagem de reagendamento.

**Plano de correção**
1. Criar uma migração para adicionar `acknowledge_cancellation` ao enum `public.action_type`.
2. Manter o código atual do `calcom-webhook`, porque ele já está enfileirando a ação correta.
3. Validar após a migração:
   - cancelar um booking pelo link do Cal;
   - confirmar que a fila recebeu `acknowledge_cancellation`;
   - confirmar que o executor processa a ação e envia a mensagem ao lead;
   - repetir o mesmo webhook/booking dentro de 24h para confirmar que a idempotência bloqueia duplicidade.

**Fora do escopo**
- Não alterar a mensagem gerada pelo SDR agora.
- Não mexer no fluxo de remarcação ou confirmação de booking.