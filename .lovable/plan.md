## Problema

Reuniões canceladas pelo lead via link da Cal.com não geram resposta do SDR. O webhook recebe o evento, mas a tabela `bookings` está com `lead_id = NULL` em 51 de 53 registros — então o bloco que enfileira `acknowledge_cancellation` em `lead_action_queue` é pulado (exige `company_id && lead_id`).

Causa: `calcom-confirm-booking` (que conhece o `lead_id`) não escreve na tabela `bookings`. Quem grava é o webhook `BOOKING_CREATED`, que tenta resolver o lead pelo email do attendee — mas o SDR usa email placeholder `noreply+<lead_id>@lovable.app`, então a resolução falha.

## Correção (3 camadas, defesa em profundidade)

### 1. `calcom-confirm-booking` passa a fazer upsert em `bookings` com o link correto
Após `Booking created successfully`, antes do `lead_activities.insert`, chamar `upsertBookingFromCalcom(supabase, bookingData.data, { company_id, lead_id, conversation_id })`. Isso garante que toda reunião agendada pelo SDR já nasce com `lead_id` e `company_id` populados — o webhook depois só atualiza status.

### 2. `calcom-webhook` aprende a extrair lead_id do email placeholder
Adicionar fallback: se attendee_email casar com regex `^noreply\+([0-9a-f-]{36})@`, usar o UUID como `lead_id` e buscar `company_id` em `leads`. Cobre cancelamentos de bookings antigos que já estão sem link.

### 3. `calcom-webhook` aceita re-link no BOOKING_CANCELLED
Hoje a resolução de `company_id`/`lead_id` ocorre antes do `upsertBookingFromCalcom`. Se a linha existir mas com `lead_id=NULL`, e a extração do placeholder (passo 2) resolver um lead, fazer `UPDATE bookings SET lead_id = ..., company_id = ... WHERE id = ...` antes de seguir.

## Fora de escopo

- Não vamos retroagir os 51 bookings históricos via migration (são dados de teste e o usuário pode resetar). A correção vale para todos os cancelamentos novos.
- Sem mudança de schema, RLS, ou UI.
- `cancel_reason` continua não sendo preenchido pelo webhook (assunto separado).

## Detalhes técnicos

**Arquivos a editar:**
- `supabase/functions/calcom-confirm-booking/index.ts` — importar `upsertBookingFromCalcom` de `../_shared/calcom.ts` e chamar logo após a criação na Cal.com, passando `company_id: selectedHold.company_id` e `lead_id`. Também resolver `conversation_id` da conversa mais recente do lead (mesmo padrão do webhook) e propagar.
- `supabase/functions/calcom-webhook/index.ts` — adicionar helper `extractLeadIdFromPlaceholder(email)` e usar como 3º fallback (após lookup por booking_uid e por attendee email real). Se resolver, fazer update da linha em `bookings` para gravar o link.

**Validação:**
- Forçar um booking via SDR, cancelar pelo link da Cal.com, verificar:
  - `bookings.lead_id` preenchido logo após criação.
  - `lead_action_queue` recebe `acknowledge_cancellation` para o `booking_uid`.
  - `execute-action` processa e envia mensagem ao lead.
- Re-checar `SELECT count(*) FILTER (WHERE lead_id IS NULL) FROM bookings WHERE created_at > now()` após a mudança — deve ser zero para novos.
