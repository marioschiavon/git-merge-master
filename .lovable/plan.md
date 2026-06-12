## Comportamento desejado

Quando o lead pede um dia (ex.: "amanhã") e a agenda não tem slots naquele dia (sábado, domingo, fim de expediente, etc.), o agente deve dizer ISSO claramente e já oferecer os próximos horários disponíveis — em vez de blamar "instabilidade no sistema" e deixar o lead esperando.

## Mudanças

### 1. `supabase/functions/sdr-agent/index.ts` — `check_calendar` com fallback automático
Quando o resultado de `calcom-slots` vier vazio para a janela pedida, fazer **uma segunda chamada** ampliando a janela para os próximos 14 dias após `end_before` (ou após `start_after` se end não veio). Retornar para o agente:

```ts
{
  slots: [...],                  // mantém shape atual; se vazio na janela, virão os próximos
  slots_in_window: [],           // explicitamente vazio
  next_available: [...],         // até 4 próximos slots fora da janela
  reason: "no_slots_in_window",
  requested_window: { start_after, end_before },
}
```

Se mesmo a janela ampliada vier vazia, retornar `{ slots: [], reason: "no_availability", ... }` (aí sim faz sentido escalate ou followup).

### 2. `supabase/functions/sdr-agent/index.ts` — regra no prompt
Adicionar em "Regras críticas":
- "Se `check_calendar` retornar `reason: 'no_slots_in_window'`, é PROIBIDO responder 'sistema instável' ou 'aguarde'. Você DEVE responder reconhecendo que não há horário na janela pedida (ex.: 'amanhã é sábado / não tenho horário no dia X') e usar `offer_slots` com os `next_available` retornados. Mensagem natural, sem culpar sistema."
- "Se `reason: 'no_availability'`, aí sim diga ao lead que a agenda está cheia pelos próximos dias e pergunte uma janela maior, ou use `escalate_to_human`."

### 3. Recolocar Juliano nos trilhos
Re-invocar o `sdr-agent` para a conversa do Juliano (ou disparar um inbound simulado), agora com o fallback. Ele deve oferecer slots de segunda em diante.

## Verificação

- Re-rodar agente para Juliano: mensagem nova explica "amanhã é sábado" (ou simplesmente "não tenho horário amanhã") e oferece 2-3 horários da semana seguinte.
- `sdr_agent_runs.final_output.decision = offer_slots` com `offered_slots` populado.

## Fora do escopo

- Não vou mexer em `calcom-slots`, regras de horário comercial, ou criar lógica de detecção de fim-de-semana no Cal.com — o fallback de ampliação de janela já cobre o caso de forma genérica (sábado, domingo, feriado, dia cheio, fim de expediente).
- Não vou tocar no BookingCard nem no fluxo de cancelamento/remarcação (já corrigidos).
