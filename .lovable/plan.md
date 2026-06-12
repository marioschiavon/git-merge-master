## Problema

O agente DECIDIU corretamente `cancel_booking` e gerou a mensagem humana:

> "Sem problemas, Juliano. Entendo perfeitamente, urgências acontecem. Vou cancelar nosso encontro. Quando a poeira baixar, a gente pode tentar de novo. Melhoras por aí."

Mas essa mensagem **nunca chegou ao lead**. O que foi enviado foi o fallback robótico "Recebi seu pedido de cancelamento e já te confirmo em instantes." porque o `calcom-booking-cancel` falhou — o `booking_uid` que o agente passou (`kAJnGRzLmRNeoBiXqGMVNX`) já estava cancelado no Cal.com (era a reserva antiga, deixada para trás pelas remarcações). A reserva ativa real é `9FHUQQniu6ZRouvNjMd4ze`.

## Causas

1. **Booking_uid errado no contexto do agente.** Em `loadContext` (sdr-agent), `activeBookings` inclui status `rescheduled` e ordena por `scheduled_at desc`. Após reschedule ida-e-volta com mesmo horário, a reserva antiga (rescheduled) aparece primeiro e vai parar no prompt como "Reserva ativa".
2. **Fallback descarta a mensagem humana do agente.** No branch `cancel_booking/reschedule_booking` do `sdr-agent`, quando o action falha o `sendFallback` ignora `fd.message` e manda texto enlatado.
3. **`calcom-booking-cancel` não tolera "already cancelled".** O Cal.com responde 400 nesse caso, virando erro fatal — deveria ser sincronização silenciosa.

## O que vou fazer

### 1. `supabase/functions/sdr-agent/index.ts` — booking_uid correto
- `loadContext`: trocar o filtro de `["confirmed","pending","rescheduled"]` para `["confirmed","pending"]` e ordenar por `updated_at desc, scheduled_at desc`.
- Mesmo filtro no fallback de resolução de `bookingUid` no branch cancel/reschedule (linhas 893-903).
- Resultado: o prompt do agente passa a apontar para a reserva REAL ativa.

### 2. `supabase/functions/sdr-agent/index.ts` — preservar mensagem humana no fallback
- `sendFallback(reason)` passa a aceitar `customMessage` opcional.
- Quando `fd.message` existir, enviar ele em vez do texto enlatado.
- Para `cancel_booking`, se o agente não incluiu convite para remarcar depois, complementar com "Se quiser, é só me dizer quando ficar mais tranquilo que a gente reagenda." (concatenado).
- Manter `handoff_required: true` para o time humano ser alertado em background, mas a conversa com o lead fica natural.

### 3. `supabase/functions/calcom-booking-cancel/index.ts` — tolerar "already cancelled"
- Capturar o erro do `calcomFetch`, detectar a string `cancelled already` e tratar como sucesso: atualiza booking no DB para `cancelled`, registra `lead_activities` e retorna `{ success: true, already_cancelled: true }`.

### 4. Corrigir o caso Juliano agora (uma vez)
- Chamar `calcom-booking-cancel` no booking ativo correto `9FHUQQniu6ZRouvNjMd4ze` (motivo: "Lead pediu cancelamento — urgência").
- Enviar via `execute-action` a mensagem humana que o agente havia gerado, complementada com convite para remarcar.

## Verificação

- DB do Juliano: todas as `bookings` ficam `cancelled` ou `rescheduled` (nenhuma `confirmed`).
- Mensagens da conversa mostram a mensagem empática enviada.
- Próximo cancelamento em outro lead: `sdr_agent_runs.final_output.live.ok = true`, `calcom-booking-cancel` retorna 200 e a mensagem efetivamente enviada é a que o LLM compôs.

## Fora do escopo

- Não vou mexer em `inbound-webhook`, slot_holds, cadência, nem em outras decisions.
- Não vou redesenhar o prompt — só os filtros de "Reserva ativa".
