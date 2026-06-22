## Problema

O lead não tinha e-mail cadastrado, mas o SDR confirmou a reunião assim mesmo usando um e-mail "placeholder" (`noreply+<lead_id>@…`) — isso é o que o flag `force_placeholder: true` faz em `sdr-agent` quando chama `calcom-confirm-booking`. Resultado: agendamento criado no Cal.com, mas o lead nunca recebe o convite por e-mail (só fica um alerta "enviar convite manualmente" em `lead_activities`).

O comportamento desejado: **se o lead não tem e-mail real, o SDR não deve agendar — deve antes pedir o e-mail ao lead, esperar a resposta, salvar em `leads.email`, e só então confirmar a reserva.**

## Plano

### 1. Bloquear `book_slot` quando falta e-mail real (`supabase/functions/sdr-agent/index.ts`)

No handler de `book_slot` (≈linha 855), antes de chamar `calcom-confirm-booking`:

- Carregar o e-mail atual do lead (`ctx.lead?.email`), considerar inválido se vazio, malformado, ou se já é um placeholder (`noreply+…@…`).
- Se o canal da conversa for `email`, o e-mail real é o próprio `from` da thread — manter o fluxo atual.
- Caso contrário (WhatsApp/LinkedIn/etc.) e e-mail ausente/placeholder:
  - **Não** invocar `calcom-confirm-booking`.
  - Marcar o `calendar_actions` claim como cancelado/abortado (sem erro fatal) para liberar retries.
  - Persistir em `lead_memory.facts.pending_email_for_slot = { hold_id, slot_iso }` para o próximo turno saber qual horário "segurar".
  - Retornar `{ ok: false, downgrade: "request_email", suggested_message: "Pra confirmar e te mandar o convite por e-mail, qual é o melhor e-mail pra te marcar nessa reunião?" }`.

O SDR já trata `downgrade + suggested_message` no fluxo padrão (ver linhas ~1352-1356) e usa a `suggested_message` no `finalize` → `send_message`.

### 2. Capturar o e-mail informado pelo lead e salvar em `leads.email`

Quando o lead responder com um e-mail no turno seguinte:

- Em `sdr-agent`, antes de decidir, checar se há `pending_email_for_slot` em `lead_memory.facts` e se a última mensagem do lead contém um e-mail válido (regex já usada em `entity-extractor.ts`).
- Se sim:
  - `UPDATE leads SET email = <novo> WHERE id = ctx.lead_id`.
  - Limpar `pending_email_for_slot` em `lead_memory.facts`.
  - Injetar no system prompt do turno um aviso: "Lead acabou de fornecer e-mail: `<email>`. Confirme a reunião no slot `<slot_iso>` chamando `book_slot` agora."

Isso faz o LLM disparar `book_slot` no mesmo turno, e como o lead agora tem e-mail real, o caminho normal (sem placeholder) é usado.

### 3. Remover o uso silencioso de `force_placeholder: true` no caminho do SDR

Linha 899 de `sdr-agent/index.ts`: trocar `force_placeholder: true` por `force_placeholder: false`. O guard novo do item 1 garante que o SDR nunca chega aqui sem e-mail real. Se por algum motivo chegar (race), `calcom-confirm-booking` devolverá 400 "Lead email is required" e o SDR cairá no caminho de erro padrão — comportamento mais seguro que agendar sem e-mail.

O `human-book-slot` (ação manual) **mantém** sua semântica atual — humano pode optar por agendar mesmo sem e-mail (e nesse caso ainda recebe o aviso em `lead_activities`). Nada muda lá.

### 4. Detalhes técnicos

- Regex de e-mail: reaproveitar `EMAIL_RE` de `_shared/entity-extractor.ts`.
- Detecção de placeholder: `/^noreply\+[a-f0-9-]+@/i.test(email)`.
- Não criar novas tabelas. Tudo cabe em `lead_memory.facts` (jsonb) e em `leads.email`.
- Não mexer em `calcom-confirm-booking`, `calcom-booking-create`, `human-book-slot` — eles já validam e-mail corretamente.

### Arquivos a alterar

- `supabase/functions/sdr-agent/index.ts` — guard pré-`book_slot`, captura de e-mail do lead em turno seguinte, troca de `force_placeholder` para `false`.
