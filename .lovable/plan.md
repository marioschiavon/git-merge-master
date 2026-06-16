## Objetivo

Depois de cancelar a reunião com sucesso, o SDR deve manter o controle da conversa: ou já oferecer 2 novos horários, ou perguntar de forma direta quando o lead prefere reagendar. Nada de encerrar a conversa com "ok, cancelei" e ficar parado.

## Comportamento esperado

Quando o lead pede para cancelar:

1. SDR chama `cancel_booking` (já funciona).
2. Após `ok: true`, a mensagem final do SDR deve sempre incluir 2 partes:
   - Confirmação curta do cancelamento ("Pronto, desmarquei nosso horário.")
   - Próximo passo proativo, em uma de duas formas:
     a. **Padrão (oferecer slots)**: se o motivo do cancelamento não indica desistência, o SDR deve chamar `book_slot` (ou reaproveitar `calcom-slots`) na sequência para gerar 2 novos horários e oferecer no mesmo turno.
     b. **Pergunta aberta**: se o lead disse algo como "cancela, depois te falo", "preciso ver minha agenda", "semana que vem te aviso" — o SDR confirma o cancelamento e faz uma pergunta direta de reagendamento ("Quer que eu já te mande 2 opções pra semana que vem ou prefere me dizer um dia melhor?").

Em nenhum caso o SDR pode terminar com "qualquer coisa estou à disposição" sem perguntar sobre reagendamento.

## Mudanças técnicas

Arquivo: `supabase/functions/sdr-agent/index.ts`

1. **Tool `cancel_booking` — `message_suggestion` retornada**
   - Hoje retorna só "Pronto, cancelei...". Mudar o `message_suggestion` para incluir um gancho de reagendamento por padrão: "Pronto, desmarquei. Quer que eu já te mande 2 novos horários ou prefere me dizer um dia melhor?"
   - Adicionar no retorno um campo `next_action: "offer_reschedule"` para sinalizar ao loop do agente que ele deve seguir.

2. **System prompt do SDR (seção de regras de cancelamento, ~linhas 1321-1330)**
   - Acrescentar regra dura: "Após `cancel_booking` com `ok:true`, é OBRIGATÓRIO no mesmo turno (a) chamar `book_slot` para oferecer 2 novos horários OU (b) terminar a mensagem com pergunta explícita de reagendamento. Nunca finalize um cancelamento sem reabrir o agendamento."
   - Adicionar exceção: se o lead disse explicitamente "não quero mais", "desisti", "não tenho interesse" → não reoferecer, apenas confirmar cancelamento e encaminhar como `escalate_to_human` ou marcar lost (seguindo a política já existente).

3. **Safety-net no final do run (~linhas 2138-2182)**
   - Quando o safety-net detectar que houve cancelamento (programático ou via tool) e a mensagem final não contém nem horários propostos nem pergunta de reagendamento, anexar automaticamente o gancho "Quer que eu já te mande 2 opções de novos horários?".
   - Critério de detecção: regex simples por horários ("às HHh", "/dd/mm", dias da semana) ou por palavras "reagendar/remarcar/novo horário/quando".

4. **Heurística para escolher entre (a) oferecer slots vs (b) pergunta aberta**
   - Reusar o classificador de intent já existente. Se a mensagem do lead que pediu cancelamento contém marcadores de adiamento indefinido ("depois te falo", "semana que vem te aviso", "preciso ver"), usar pergunta aberta. Caso contrário, default = oferecer 2 slots.

## Validação

- Caso 1: lead diz "cancela essa reunião" → SDR cancela + envia 2 novos horários no mesmo turno.
- Caso 2: lead diz "cancela, depois te aviso quando posso" → SDR cancela + pergunta "quer que eu mande 2 opções pra semana que vem ou prefere me dizer um dia?".
- Caso 3: lead diz "cancela, não tenho mais interesse" → SDR cancela + encerra/encaminha (sem reoferecer).
- Verificar nos logs do `sdr-agent` que `steps` contém o `cancel_booking` seguido de `book_slot` (caso 1) ou da mensagem com gancho (caso 2).
- Confirmar no banco: `bookings.status='cancelled'`, `slot_holds` do horário antigo `released`, novos `slot_holds` `held` (caso 1).

## Fora de escopo

- HITL continua igual: aprova apenas a mensagem final consolidada (com confirmação + reoferta).
- Sem mudança em `calcom-booking-cancel`, `calcom-slots`, `calcom-booking-create`.
