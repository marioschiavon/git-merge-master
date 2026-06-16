# Mensagens honestas quando uma ação do agente falha

## O que aconteceu (diagnóstico)
1. Lead pediu **"Cancele a reuniao. Nao poderei mais participar"**.
2. O Policy Engine classificou intent como `cancel_booking` e forçou a ferramenta `cancel_booking` no SDR agent. ✅ correto
3. A ferramenta chamou `calcom-booking-cancel`, que **retornou erro não-2xx** (`FunctionsHttpError`). A linha em `calendar_actions` ficou com `status=failed`. ✅ detectado
4. O agente entrou no fallback genérico do `sdr-agent` (linha 1762-1764) — que **é hardcoded para falha de book/reschedule** — e mandou para aprovação a mensagem:
   > "Tive uma instabilidade aqui pra confirmar esse horário. Pode me mandar outro dia/horário que funcione pra você? Vou garantir a reserva."
   - **Mente** ("instabilidade pra confirmar"): a falha foi ao **cancelar**, não ao confirmar.
   - **Pivota para o oposto do pedido**: pede novo horário em vez de reconhecer o cancelamento solicitado.
5. Você corretamente rejeitou no HITL. A reserva no Cal.com **continua ativa** (booking ainda `confirmed`).

## Correções

### 1. Fallback honesto por tipo de ferramenta — `supabase/functions/sdr-agent/index.ts`
Substituir o fallback único (linhas ~1759-1769) por mensagens específicas por `forcedToolName`:

- `cancel_booking` →
  > "Tive um problema técnico aqui pra processar o cancelamento agora. Anotei seu pedido e vou tentar de novo em alguns minutos — confirmo assim que conseguir. Tudo bem?"
- `reschedule_booking` →
  > "Tive um problema pra remarcar agora. Sua reunião segue no horário atual. Vou tentar de novo e te confirmo em seguida."
- `book_slot` (mantém o atual, sem afirmar que confirmou):
  > "Não consegui confirmar esse horário agora. Pode me mandar outro dia/horário que funcione pra você? Vou tentar de novo."
- default → mensagem genérica honesta, sem dizer "instabilidade pra confirmar" quando não houve confirmação.

Aplicar o mesmo princípio nas mensagens hardcoded das linhas 1978 e 2034 (loops de book/add_guests): trocar "garantir a reserva" por algo que não pressuponha a ação seguinte do lead, e nunca usar a frase para casos de cancel.

### 2. Não pivotar — manter o intent original
Quando `forcedToolName === "cancel_booking"` falha:
- **Não** sugerir novo horário.
- **Não** marcar `decision: send_message` que altere o tópico — manter a intenção de cancelar.
- Idealmente agendar um retry curto da própria operação de cancel (ver item 4).

### 3. Sinalizar a falha na fila de aprovações
No card de `/approvals` da `sdr_reply` resultante, mostrar um **alerta de aviso** quando o run associado contém `rationale` começando com `Forced … failed:` — isso ajuda o humano a perceber rápido que a IA tentou mascarar uma falha.

Adicionar bandeira `tool_failure` no `context` do `approval_request` (preenchida em `sdr-agent` quando entra no fallback), e renderizá-la em `src/pages/Approvals.tsx` como banner vermelho: "⚠️ Ferramenta `cancel_booking` falhou — revise com cuidado".

### 4. Retry leve + diagnóstico de `calcom-booking-cancel`
- Em `supabase/functions/_shared/idempotency.ts` (ou no caller `cancel_booking` dentro de `sdr-agent`): se o `calcom-booking-cancel` falhar com erro de rede/5xx, **uma** retentativa imediata com pequeno backoff antes de cair no fallback.
- Em `supabase/functions/calcom-booking-cancel/index.ts`: garantir que o erro do Cal.com chegue na resposta JSON (status 502 com `error_message` legível) em vez de propagar `FunctionsHttpError` opaco — isso já beneficia logs e a UX.

## Fora de escopo (agora)
- Cancelar automaticamente pela UI sem aprovação (você optou por HITL universal).
- Reabrir a reserva atual: como o cancelamento real falhou, a reunião **ainda está confirmada** — nada a desfazer no Cal.com. Basta tentar cancelar de novo.

## Arquivos afetados
- `supabase/functions/sdr-agent/index.ts` — fallbacks por tipo de tool + flag `tool_failure` no approval
- `supabase/functions/calcom-booking-cancel/index.ts` — propagar mensagem de erro útil
- `src/pages/Approvals.tsx` — banner de aviso quando `context.tool_failure` presente

## Próximo passo manual (após o deploy)
Na conversa atual, basta aprovar uma nova tentativa de cancel (ou rejeitar de novo se preferir cancelar pelo Cal.com manualmente). A reunião continua marcada até lá.
