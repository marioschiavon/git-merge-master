# Diagnóstico: cancelamento via link Cal.com

## O que aconteceu — booking `d8ERZG7aWC1ymNsYCMs2dh` (Juliano)

✅ **Webhook recebeu e processou** (`signature_valid=true`, `processed=true`).
✅ **`bookings.lead_id` foi populado** (`0928e5f1…`) — confirma que o fix anterior em `calcom-confirm-booking` está funcionando.
✅ **Status atualizado para `cancelled`** com motivo `"Nao posso"`.
❌ **`acknowledge_cancellation` NÃO foi enfileirado** — o SDR não vai responder.

## Por que não respondeu

Payload do `BOOKING_CANCELLED`:
- `cancelledBy: "eu@julianocarneiro.com.br"` (lead que clicou no link)
- `organizer.email`: também `eu@julianocarneiro.com.br` (você está testando com seu próprio email como lead)

O guard `cancelledByOrganizer` (linha 221 de `calcom-webhook/index.ts`) compara `cancelledByEmail === organizerEmail`. Como ambos batem, ele entende que **você (organizador) cancelou** e pula o follow-up por desenho — para não responder ao lead quando o SDR/operador é quem cancela.

Em produção real, o email do lead será diferente do organizador e o follow-up dispararia normalmente. Aqui é um artefato do teste com email próprio.

## Recomendação

Endurecer a detecção para reduzir falsos positivos:

### Mudança em `supabase/functions/calcom-webhook/index.ts` (~linha 221)

Tratar como "cancelado pelo organizador" **somente quando houver sinal explícito**, e não só pelo email coincidente:

1. Se `cancellation_source` interno (`sdr`, `sdr_reschedule`, `operator`) foi marcado nos últimos 5 min → organizador. (já existe)
2. Se o `cancelledBy.email` casa com o organizador **E** o lead tem email diferente → organizador.
3. Se o lead tem o mesmo email do organizador (caso de auto-teste ou cliente interno), confiar no `cancellation_source` interno; sem ele, assumir **lead**.

Resumindo a nova condição:
```ts
const leadEmailLower = (lead?.email || "").toLowerCase();
const sameEmailAsLead = !!leadEmailLower && cancelledByEmail === leadEmailLower;
const cancelledByOrganizer =
  !!cancelledByEmail &&
  !!organizerEmailLower &&
  cancelledByEmail === organizerEmailLower &&
  !sameEmailAsLead;  // se o email também bate com o lead, não conclua organizador
```

### Validação

1. Reproduzir cancelamento via link Cal.com com o mesmo lead Juliano.
2. Conferir em `lead_action_queue` que `acknowledge_cancellation` aparece com `triggered_by='calcom_webhook'`.
3. Verificar que o `execute-action` envia a mensagem empática na conversa do lead.
4. Verificar que cancelamentos via "Cancelar reunião" pelo painel (SDR) continuam **não** disparando follow-up (porque `cancellation_source='sdr'` foi marcado nos 5 min anteriores).

## Fora de escopo

- Backfill dos cancelamentos antigos sem follow-up (`w8S1sk…`, `n1B66a…`, `4yDGD…`).
- Mudanças em RLS, UI ou no campo `cancel_reason`.

## Pergunta

Quer que eu implemente esse ajuste no guard agora?
