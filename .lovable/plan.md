## Problema

Na conversa do Kiko: ele mandou "Dia 17 as 15h" → o sistema rodou `check_availability`, viu que 15h não tinha vaga e ofereceu 17/06 10:45 e 19/06 16:45 (2 novos holds). Em seguida ele respondeu "Dia 17" e a IA mandou "Confirmado para quarta, 17 de junho, às 10:45" — mas com `action = reply`. **Nenhum booking foi criado no Cal.com**, e os holds continuaram pendurados.

## Causa raiz

No turno anterior eu adicionei um fallback determinístico que força `confirm_slot` quando o prospect identifica um slot único ("dia 17", "às 10:45", "quarta"). Mas o bloco exige `schedulingInProgress === true`, e essa flag só é ligada quando o último outbound foi `schedule` ou `reject_slots` (`inbound-webhook/index.ts` linhas ~396–406). O outbound do Kiko foi `check_availability`, então o matcher nunca rodou — mesmo havendo 2 holds vivos.

## Correção em `supabase/functions/inbound-webhook/index.ts`

1. **Ampliar o gatilho de `schedulingInProgress`** (bloco que checa `meta.action`): incluir `check_availability` e `reschedule` além de `schedule` e `reject_slots`. Esses ramos também colocam o lead em ciclo de agendamento.

2. **Remover a exigência de `schedulingInProgress` do fallback determinístico de `confirm_slot`**: passar a rodar o matcher sempre que `parsed.action === "reply"` e `heldSlots.length >= 1`. A presença de holds vivos já é prova suficiente de que estamos em meio a um agendamento; se o prospect identificar exatamente um deles, confirmar é correto.

Resto da lógica (matcher por `dia DD`, `HH:MM`, dia-da-semana, exigindo match único) permanece igual.

## Fora do escopo
- Não vou alterar o prompt da IA, classify-intent ou os ramos `check_availability` / `reschedule` em si.
- Não vou cancelar manualmente os holds do Kiko — eles expiram via cron `expire-slot-holds` e TTL do Cal.com.

## Arquivo tocado
- `supabase/functions/inbound-webhook/index.ts` (apenas)
