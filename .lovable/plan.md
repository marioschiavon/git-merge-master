## Problema observado

Quando o lead responde com o e-mail que tinha sido solicitado pelo SDR, o agente está fazendo **duas coisas erradas** no turno seguinte:

1. **Pede uma reconfirmação desnecessária** ("Recebi seu e-mail. Só para confirmar: podemos agendar para quarta, 24/06 às 15:30?"). O horário já estava acordado e segurado — basta agradecer e confirmar.
2. Em alguns casos, **re-oferece slots** (chama `check_calendar` de novo) em vez de chamar `book_slot` no slot que já estava em hold.

Causa: o hint atual em `sdr-agent` (`⚠️ AÇÃO OBRIGATÓRIA…`) instrui o LLM a "chamar book_slot agora", mas não proíbe `check_calendar` nem proíbe redação tipo "podemos confirmar?". O LLM acaba seguindo o instinto conservador de pedir OK antes de reservar.

## Plano

Editar **apenas** `supabase/functions/sdr-agent/index.ts` (sem mexer em Cal.com nem em outras funções).

### 1. Reforçar o hint quando `pending_email_resolved` está setado (linha ~1455)

Trocar o texto atual por uma instrução mais rígida que:

- **Proíbe** chamar `check_calendar`, `offer_two_slots` ou pedir reconfirmação.
- **Obriga** chamar `book_slot({ slot_start: <slot_iso> })` direto.
- **Define o tom da mensagem final**: agradecer recebimento e confirmar a reunião com data/hora formatada em pt-BR — sem perguntas, sem "podemos confirmar?".
- Exemplo de mensagem desejada: *"Perfeito, Juliano! Reunião confirmada para quarta, 24/06 às 15:30. Você vai receber o convite por e-mail. Até lá!"*

### 2. Guard defensivo no handler de `check_calendar`

No início do handler de `check_calendar` (e `offer_two_slots`), se `ctx.pending_email_resolved` estiver setado, **abortar** e retornar `{ ok:false, downgrade:"book_now", suggested_message:null, next_action:"chame book_slot com o slot_iso já acordado" }`. Isso protege contra o LLM ignorar o hint.

### 3. Hint persistir até a reserva sair

Hoje `pending_email_resolved` só vive na request (não é salvo). Se o LLM, mesmo assim, mandar mensagem sem reservar, no turno seguinte o flag some e perdemos contexto. Manter um flag em `lead_memory.facts.email_just_resolved_slot = { slot_iso, expires_at }` (TTL de 10 min) e limpá-lo só quando `book_slot` for confirmado com sucesso. Carregar esse flag no início do turno do mesmo jeito que `pending_email_for_slot`.

### 4. Não mexer no caminho normal

Nada muda quando o lead já tinha e-mail desde o início — fluxo continua igual.

## Detalhes técnicos

- Arquivo: `supabase/functions/sdr-agent/index.ts`.
- Mudanças isoladas: bloco do hint (linha ~1455), handlers de `check_calendar`/`offer_two_slots`, e bloco de captura de e-mail (linha ~1774-1805) onde o flag passa a também ser persistido em `lead_memory.facts.email_just_resolved_slot`.
- Limpeza do flag: dentro do handler de `book_slot`, após o `calcom-confirm-booking` retornar sucesso, fazer um upsert removendo `email_just_resolved_slot` e `pending_email_for_slot` de `facts`.
- Não precisa migration nem novas tabelas.
