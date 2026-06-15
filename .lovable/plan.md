## Diagnóstico

### 1) Por que o SDR disse "tive uma instabilidade"
Na run `b286a33c…` (15/06 21:18) o handler `add_guests_to_active_booking` tentou **recriar** o booking no mesmo slot (rebook-first, cancel-after) e o Cal.com devolveu non-2xx — porque o slot ainda estava ocupado pelo próprio booking original que só seria cancelado no passo seguinte. O safety-net entrou e avisou a lead corretamente.

A causa raiz é a estratégia: tentamos resolver "adicionar convidado" cancelando e recriando, quando o Cal.com tem endpoint próprio pra isso.

### 2) Por que o SDR mandou 2× a mesma mensagem
Toda resposta por e-mail é gravada duas vezes em `messages`:
- `gmail-send` insere a linha "oficial" (com `gmail_message_id`, `rfc_message_id`, subject)
- `execute-action › sendOutbound` insere outra linha logo depois (`metadata.source = "execute-action"`)

Ocorre em todos os turnos (21:02, 21:14, 21:18 — sempre duas linhas com ~30ms de diferença). Não é envio duplicado pelo Gmail; é **dupla escrita no banco** que vira duas bolhas idênticas na UI.

## Plano de correção

### A) Usar o endpoint nativo do Cal.com (sem cancelar)
O Cal.com v2 expõe `POST /v2/bookings/{bookingUid}/guests` — adiciona convidados, atualiza o evento no Google Calendar conectado e dispara e-mail para os novos. Aceita até 10 convidados/chamada, máx 30 totais, rate limit 5/min (`cal-api-version: 2024-08-13`, que já usamos).

Mudanças:
1. **Nova edge function** `supabase/functions/calcom-add-guests/index.ts`:
   - Body: `{ booking_uid, guests: string[], lead_id?, conversation_id? }`.
   - Valida e-mails, deduplica, remove o próprio lead.
   - Idempotência via `claimCalendarAction` com `action_type: "add_guests"` e payload incluindo os e-mails ordenados (assim retentativas com a mesma lista batem replay; uma lista diferente vira nova ação).
   - Chama `POST /v2/bookings/{uid}/guests` via `calcomFetch` (passa `name` derivado do e-mail; `timeZone` opcional).
   - No sucesso: atualiza `bookings.raw_payload.guest_emails` e `bookings.attendees` (merge), insere `lead_activities` ("👥 Convidado(s) adicionado(s): …"), `markCalendarActionOk`.
   - No erro: `markCalendarActionFailed`, devolve 4xx/5xx com `error`.

2. **`supabase/functions/sdr-agent/index.ts`** — handler `add_guests_to_active_booking` (linhas ~569-700):
   - Substituir toda a lógica de rebook+cancel pela invocação de `calcom-add-guests` com a lista mesclada.
   - Em caso de erro/rate-limit: **não cancelar nada**, sinalizar `failures` (safety-net já cobre — a reunião segue intacta e o lead recebe a mensagem honesta).
   - Manter `cancellation_source = sdr_add_guests` **apenas** no fluxo legado, se ainda houver caminho para cancelamento — neste novo desenho não há cancel, então remover esse trecho.

3. **`supabase/functions/_shared/calcom.ts`**: opcionalmente expor helper `addGuestsToBooking(uid, guests)` para reutilizar.

### B) Eliminar duplicação de `messages` no canal e-mail
Em `supabase/functions/execute-action/index.ts`:
- No helper `sendOutbound` (linhas 113-194): **não inserir** em `messages` quando `channel === "email"` e o `gmail-send` retornou sucesso — o `gmail-send` é o dono dessa persistência. Continuar inserindo se o envio falhou (registrar `delivery_status: "failed"`) ou em canais que não persistem por conta própria (whatsapp/linkedin/pending_manual).
- No `schedule_followup › lead_request › email` (linha 281): remover o `insert` redundante pelo mesmo motivo.

### C) Testes
- Novo `supabase/functions/calcom-add-guests/index.test.ts`: mock do Cal.com retornando 200 → verifica claim ok + merge no `bookings.raw_payload`; mock retornando 429/500 → verifica `markCalendarActionFailed` e resposta de erro.
- Em `supabase/functions/sdr-agent/`: mock de `calcom-add-guests` retornando erro → verifica que **não** há chamada a `calcom-booking-cancel`/`calcom-booking-create` e que `failures` contém `add_guests_to_active_booking`.
- Smoke do `execute-action`: enviar e-mail e checar que `messages` ganha exatamente **uma** linha (com `gmail_message_id`).

### D) Recuperação manual da conversa atual
Após o deploy, disparar `calcom-add-guests` no UID ativo `f4MAXD8wFyQEyVn9L9CZ7X` com `guests: ["joao@julianocarneiro.com.br"]` e, em seguida, `execute-action › send_reply` confirmando para a Carolina que o João já está no convite — sem cancelar nada.

### Arquivos afetados
- Novo: `supabase/functions/calcom-add-guests/index.ts` (+ teste).
- Editado: `supabase/functions/sdr-agent/index.ts` (handler `add_guests_to_active_booking`).
- Editado: `supabase/functions/execute-action/index.ts` (`sendOutbound` + `schedule_followup`).
- Opcional: helper em `supabase/functions/_shared/calcom.ts`.
