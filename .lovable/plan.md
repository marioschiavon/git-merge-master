# Bug: SDR manda "acknowledge_cancellation" depois de já ter respondido ao cancelamento

## O que aconteceu na conversa do Juliano

```
13:58:17  Lead     "Não quero mais fazer reunião e conhecer o produto"
13:58:48  SDR      "Entendido, Juliano. A reunião está cancelada..."   ← cancel_booking + reply
13:58:49  SYSTEM   "❌ Reunião cancelada"                                ← webhook BOOKING_CANCELLED
13:59:40  Lead     "Quero marcar novamente"
14:00:11  SDR      "Oi Juliano, vi que você cancelou nossa conversa..." ← acknowledge_cancellation  ❌
14:00:28  SDR      "Claro, Juliano. Acontece! Encontrei duas opções..." ← resposta correta ao 13:59
```

A mensagem das 14:00:11 (`action: acknowledge_cancellation`, `booking_uid: ranM5UgTVZKY84GYEXtsqp`) é redundante: quem cancelou foi o próprio SDR via `cancel_booking`, atendendo o lead. O Cal.com webhook ainda assim disparou `BOOKING_CANCELLED` e o `calcom-webhook` enfileirou `acknowledge_cancellation` porque não conseguiu detectar que o cancelamento veio do organizer.

## Causa

Em `supabase/functions/calcom-webhook/index.ts` (linhas 144–156), a detecção é feita só por e-mail:

```ts
const cancelledByOrganizer = !!cancelledByEmail && cancelledByEmail === organizerEmailLower;
const cancelledByLead = !cancelledByOrganizer;
```

Quando o cancelamento é via API com a `CALCOM_API_KEY` (caso do `cancel_booking`), o Cal.com normalmente devolve `cancelledByEmail` vazio — então cai em `cancelledByLead=true` e o acknowledge é enfileirado.

## Mudanças

### 1. Marcar a origem do cancelamento no banco antes de chamar Cal.com

Migration: adicionar coluna `cancellation_source TEXT` em `public.bookings` (valores esperados: `sdr`, `human`, `lead`, `system`, `expired`; nullable).

Em `supabase/functions/execute-action/index.ts`, no handler de `cancel_booking`:

- Antes de invocar `calcom-booking-cancel`, fazer `UPDATE bookings SET cancellation_source='sdr', cancellation_requested_at=now() WHERE calcom_booking_uid=? AND status IN ('confirmed','pending')`.
- Se a cadeia de execução tiver `triggered_by` humano (ex.: UI), passar `cancellation_source='human'` em vez de `sdr`. Como hoje o cancel sempre vem do agente, default `sdr` cobre 100% do caso atual.

Mesmo tratamento em `calcom-booking-cancel` para cancelamentos chamados diretamente pela UI/Bookings page (passar `source` no body, default `sdr`).

### 2. calcom-webhook: respeitar a marca

Em `calcom-webhook/index.ts`, no case `BOOKING_CANCELLED`, antes do enqueue:

```ts
const { data: bk } = await supabase
  .from("bookings")
  .select("cancellation_source, cancellation_requested_at")
  .eq("calcom_booking_uid", bookingUid)
  .maybeSingle();
const recentlyMarked = bk?.cancellation_requested_at
  && Date.now() - new Date(bk.cancellation_requested_at).getTime() < 5 * 60_000;
if (recentlyMarked && bk.cancellation_source !== 'lead') {
  console.log("calcom-webhook: cancellation initiated internally, skipping acknowledge.");
  break;
}
```

Manter também a checagem por e-mail atual (defesa em profundidade).

### 3. Safety net adicional no executor

Em `execute-action`, no handler de `acknowledge_cancellation`, antes de enviar:

- Se houver mensagem outbound do SDR nos últimos 10 min nesta conversa cujo `metadata->>action` seja `cancel_booking` ou `send_reply` em resposta direta ao cancelamento (heurística: outbound do SDR enviada nos últimos 10 min E booking foi cancelado nesse intervalo), marcar a ação como `skipped` e retornar `{ sent: false, reason: "already_acknowledged" }`.
- Isso protege contra qualquer outra origem futura que enfileire acknowledge incorretamente.

### 4. Re-classificar o cancelamento já gravado (cleanup pontual)

Sem ação SQL retroativa — só sigam frente. O lead 61a9b13e já recebeu a duplicação; o fix evita repetição.

## Arquivos

- `supabase/migrations/<novo>.sql` — `ALTER TABLE bookings ADD COLUMN cancellation_source TEXT, ADD COLUMN cancellation_requested_at TIMESTAMPTZ`.
- `supabase/functions/execute-action/index.ts` — handler `cancel_booking` grava a marca; handler `acknowledge_cancellation` ganha safety net.
- `supabase/functions/calcom-booking-cancel/index.ts` — propaga `source` para a marca (opcional).
- `supabase/functions/calcom-webhook/index.ts` — lê a marca antes de enfileirar acknowledge.

## Fora de escopo

- Não muda UI, debounce, sdr-agent, lógica de slot/oferta.
- Não muda comportamento de cancelamento pelo link público do Cal.com (lead clicando no link continua disparando `acknowledge_cancellation`, que é o comportamento desejado).

## Verificação

- Simular cancel via SDR (`execute-action cancel_booking`) e conferir que o webhook subsequente NÃO enfileira `acknowledge_cancellation` (log mostra "skipping").
- Simular cancel pelo link público do Cal.com (sem marcar a coluna) e conferir que o acknowledge continua sendo enviado.
- Verificar `lead_action_queue` para o lead de teste — só deve existir um `acknowledge_cancellation` por cancelamento iniciado pelo lead.
