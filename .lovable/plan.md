

## Adicionar ações "reject_slots" e "check_availability" ao fluxo de agendamento

### Problema
Quando o prospect recusa ambos os horários oferecidos ou sugere um horário alternativo, o sistema não sabe o que fazer. Falta:
1. Cancelar os 2 holds existentes e oferecer 2 novos slots
2. Verificar se um horário sugerido pelo prospect está disponível no Cal.com

### Mudanças

**1. `supabase/functions/inbound-webhook/index.ts`**

Adicionar 2 novas ações no prompt da IA:
- `"reject_slots"` — prospect rejeitou ambos os horários. O sistema cancela os 2 holds e busca 2 novos slots via `calcom-slots`
- `"check_availability"` — prospect sugeriu um horário específico (ex: "terça às 10h"). O sistema verifica disponibilidade no Cal.com

Atualizar o bloco de slotContext para incluir instruções sobre essas novas ações.

Lógica de execução:
- `reject_slots`: cancelar holds existentes via `DELETE /v2/slots/reservations/{uid}`, marcar como `cancelled` no DB, invocar `calcom-slots` para buscar 2 novos slots e oferecer ao prospect
- `check_availability`: extrair datetime sugerido do campo `suggested_datetime` retornado pela IA, buscar slots do Cal.com, verificar se o horário existe na lista. Se sim, reservar e confirmar. Se não, informar indisponibilidade e oferecer 2 alternativas

Atualizar o prompt do sistema:
```
AÇÕES POSSÍVEIS:
- "confirm_slot": prospect escolheu 1 dos horários oferecidos
- "reject_slots": prospect rejeitou ambos os horários (ex: "nenhum funciona", "tenho compromisso nesses dias")
- "check_availability": prospect sugeriu horário próprio (ex: "pode ser terça às 14h?")
  → inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)
- "reply": responder objeção/dúvida
- "schedule": interesse em reunião sem slots pendentes
- "pause": rejeição total

JSON de resposta inclui novo campo:
"suggested_datetime": "2026-04-15T14:00:00" (apenas para check_availability)
```

**2. `supabase/functions/calcom-slots/index.ts`**

Adicionar suporte a parâmetro opcional `check_datetime` no body. Quando presente:
- Buscar slots disponíveis do Cal.com normalmente
- Verificar se o datetime solicitado está na lista de slots disponíveis (com tolerância de 5 minutos)
- Retornar `{ available: true/false, exact_slot: "..." }` além dos dados normais
- Se disponível, reservar apenas esse slot (1 hold, não 2)

### Detalhes do fluxo

```text
Prospect: "Nenhum dos dois funciona"
  → IA retorna action=reject_slots
  → Sistema cancela 2 holds no Cal.com e DB
  → Sistema busca 2 novos slots via calcom-slots
  → SDR responde com 2 novas opções

Prospect: "Pode ser quarta às 15h?"
  → IA retorna action=check_availability, suggested_datetime="2026-04-15T15:00:00"
  → Sistema checa no Cal.com se esse slot existe
  → Se sim: reserva + confirma booking direto
  → Se não: informa indisponibilidade + oferece 2 alternativas próximas
```

### Escopo
- 2 edge functions atualizadas (`inbound-webhook`, `calcom-slots`)
- Nenhuma mudança de banco ou UI

