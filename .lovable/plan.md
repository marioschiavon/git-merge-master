

## Confirmar slot escolhido e cancelar o outro

### Contexto
Hoje, quando o prospect responde escolhendo um dos 2 horários oferecidos, a IA não sabe que precisa confirmar o booking no Cal.com. Falta a lógica de:
1. Detectar que o prospect está confirmando um slot
2. Criar o booking definitivo no Cal.com (`POST /v2/bookings`)
3. Cancelar a reserva do outro slot (`DELETE /v2/slots/reservations/{uid}`)
4. Atualizar `slot_holds` (confirmed / cancelled)
5. Marcar enrollment como `completed` com `meeting_scheduled = true`

### Mudanças

**1. Nova ação na IA — `inbound-webhook/index.ts`**

Adicionar `"confirm_slot"` como ação possível no prompt do sistema. Quando o prospect responde a uma mensagem com 2 slots, a IA deve retornar:
```json
{
  "action": "confirm_slot",
  "selected_slot": 1,  // ou 2
  "reply_message": "Perfeito! Reunião confirmada para..."
}
```

Antes de chamar a IA, verificar se existem `slot_holds` com status `held` para esse lead. Se sim, incluir os slots no contexto da IA para que ela saiba quais são as opções.

**2. Nova edge function — `calcom-confirm-booking/index.ts`**

Responsável por:
- Receber `lead_id`, `selected_slot_hold_id`
- Buscar os 2 `slot_holds` do lead com status `held`
- Criar booking definitivo no Cal.com: `POST /v2/bookings` com `cal-api-version: 2024-08-13`
  ```json
  {
    "eventTypeId": <id>,
    "start": "<slot_datetime>",
    "attendee": {
      "name": "<lead_name>",
      "email": "<lead_email>",
      "timeZone": "America/Sao_Paulo",
      "language": "pt"
    }
  }
  ```
- Cancelar a reserva do outro slot: `DELETE /v2/slots/reservations/{reservationUid}`
- Atualizar `slot_holds`: slot escolhido → `confirmed`, outro → `cancelled`
- Atualizar `cadence_enrollments`: `status = completed`, `meeting_scheduled = true`
- Registrar atividade em `lead_activities`

**3. Atualizar `inbound-webhook/index.ts`**

- Buscar `slot_holds` com status `held` para o lead antes da análise IA
- Se existirem holds, adicionar ao contexto da IA: "O prospect recebeu 2 opções de horário: 1) ... 2) ..."
- Quando `parsed.action === "confirm_slot"`: invocar `calcom-confirm-booking` com o slot selecionado
- Enviar mensagem de confirmação ao prospect

### Escopo
- 1 nova edge function (`calcom-confirm-booking`)
- 1 edge function atualizada (`inbound-webhook`)
- Nenhuma mudança de banco (tabelas já suportam os status necessários)

