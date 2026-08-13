# Correção: reunião "confirmada" pelo agente sem convite no Cal.com (empresa Qualé)

## O que aconteceu na conversa Roger x Nico

Rastreamento da conversa por email do lead `nico@leaderei.com.br` na empresa Qualé (13/08/2026):

1. 16:04 — lead pede reunião. O agente chamou `check_calendar`, que retornou `reason: "no_availability"` e **zero slots** (os tipos de evento do Cal.com dessa empresa só foram sincronizados às 16:12, depois dessa checagem).
2. 16:15 — o agente executou a ação `offer_slots` **sem nenhum hold válido**. O resultado ficou registrado como `no_valid_holds_sent_anyway`: o sistema enviou mesmo assim a mensagem escrita pela IA, que continha horários inventados ("quinta 20 às 10h" e "sexta 21 às 15h").
3. 16:16 — lead escolhe "Sexta dia 21".
4. 16:17 — o agente chamou `book_slot` com `2026-08-21T15:00:00-03:00` e recebeu `slot_not_offered` ("does not match any offered or currently held slot"). Nenhuma reserva foi criada.
5. 16:21 — mesmo assim o agente enviou "Confirmado: sexta-feira, dia 21, às 15h. Você receberá um convite no seu e-mail em breve".

Confirmado no banco: **não existe nenhum registro em `bookings` nem em `slot_holds`** para esse lead. Ou seja, o convite nunca foi criado — o Cal.com nunca chegou a ser acionado com sucesso, e o convite que o cliente esperava não existe.

## Causa raiz

Duas falhas encadeadas:

- **A** — Quando `offer_slots` não tem holds válidos, o código atual (`sdr-agent`) envia a mensagem original da IA, que já contém horários inventados. Deveria substituir por um texto seguro, sem horários.
- **B** — Não existe trava de confirmação: depois de `book_slot` falhar, o agente pode enviar texto afirmando que a reunião está confirmada e que o convite chegará, sem que exista booking.

## O que será feito

1. **Nunca enviar horários não reservados**
   No caminho "sem holds válidos" do `offer_slots`, descartar a mensagem da IA e enviar sempre um texto neutro ("estou confirmando a agenda e te retorno com horários"), registrando o motivo. Assim o lead nunca recebe um horário que não existe.

2. **Trava anti-confirmação falsa**
   Antes de enviar qualquer resposta, verificar se o texto afirma agendamento confirmado / envio de convite. Se não existir booking ativo nem hold válido para o lead, reescrever a mensagem para pedir a escolha entre horários reais (ou pedir que o agente ofereça slots de verdade).

3. **Fallback quando o calendário está vazio**
   Se `check_calendar` retornar `no_availability`, o agente deve responder pedindo a preferência do lead e sinalizar internamente que a agenda não respondeu, em vez de seguir para oferta de horários.

4. **Recuperar o caso do Nico**
   Verificar se a agenda da Qualé já retorna horários (os event types foram sincronizados às 16:12) e, se sim, sinalizar na Inbox/Aprovações que essa conversa tem uma reunião prometida sem booking, para o time da Qualé criar a reserva de sexta 21/08 15h e disparar o convite.

5. **Bump de versão** conforme a regra (+0.1).

## Detalhes técnicos

- `supabase/functions/sdr-agent/index.ts` (~linha 2590): trocar `fallbackMsg` para ignorar `fd.message` e usar somente o texto neutro; manter `error: "no_valid_holds"` no log.
- Mesmo arquivo: adicionar um guard antes do `execute-action` de `send_reply` que detecta padrões de confirmação ("confirmado", "agendado", "receberá um convite", "está marcado") e consulta `bookings` (status ativo) / `slot_holds` (não expirados) do lead; sem registro, substitui a mensagem.
- Caminho de `check_calendar` com `reason: "no_availability"`: forçar a política para pedir preferência de horário em vez de `offer_slots`.
- Nenhuma mudança de schema é necessária.
