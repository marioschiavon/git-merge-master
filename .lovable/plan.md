

## Integração Cal.com — Agendamento Inteligente com Reserva de Slots

### O que será feito
Integrar o Cal.com via API para que, quando a IA decidir `action = "schedule"`, o sistema automaticamente:
1. Busque 2 slots disponíveis em dias diferentes na agenda do Cal.com
2. Ofereça os 2 horários ao prospect na mensagem
3. Reserve (hold) os slots temporariamente
4. Se o prospect não responder em 2h, cancele os holds, envie mensagem pelo canal mais usado dizendo que os horários foram ocupados + link do Cal.com

### Detalhes técnicos

**1. Secret — Cal.com API Key**
- Adicionar secret `CALCOM_API_KEY` via `add_secret`
- Adicionar secret `CALCOM_EVENT_TYPE_ID` (ID do tipo de evento no Cal.com)
- Adicionar secret `CALCOM_BOOKING_LINK` (ex: `https://cal.com/usuario/reuniao`)

**2. Migração — nova tabela `slot_holds`**
```sql
CREATE TABLE public.slot_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  enrollment_id uuid,
  conversation_id uuid,
  slot_datetime timestamptz NOT NULL,
  cal_booking_uid text, -- UID do booking no Cal.com (se houver hold)
  status text NOT NULL DEFAULT 'held', -- held | confirmed | expired | cancelled
  expires_at timestamptz NOT NULL, -- now() + 2 hours
  preferred_channel text, -- canal mais usado pelo lead
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.slot_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company slot holds"
  ON public.slot_holds FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company slot holds"
  ON public.slot_holds FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
```

**3. Nova Edge Function — `calcom-slots`**
Responsável por:
- `GET /calcom-slots?days=7` → busca disponibilidade via Cal.com API (`/slots/available`)
- Seleciona 2 slots em dias diferentes
- Cria bookings temporários (ou apenas registra na tabela `slot_holds`)
- Retorna os 2 slots formatados

**4. Nova Edge Function — `expire-slot-holds`**
Cron job (a cada 15min) que:
- Busca `slot_holds` com `status = 'held'` e `expires_at < now()`
- Cancela o booking no Cal.com (se tiver `cal_booking_uid`)
- Atualiza status para `expired`
- Determina canal mais usado (contando mensagens excluindo telefone)
- Envia mensagem: "Infelizmente devido à alta demanda, os horários X e Y já foram ocupados. Acesse [link Cal.com] para escolher o melhor horário para você."

**5. Atualizar `inbound-webhook`**
Quando `action = "schedule"`:
- Chamar `calcom-slots` para buscar 2 slots
- Incluir os horários na `reply_message` da IA
- Salvar os holds na tabela `slot_holds`
- Se o prospect responder confirmando um slot, criar booking definitivo no Cal.com e cancelar o outro

**6. Atualizar `cadence-executor`**
- Quando IA sugere reunião, incluir os 2 slots disponíveis na mensagem gerada

**7. UI — Integrations page**
- Adicionar card Cal.com na página de integrações com campo para API Key + Event Type ID + Link de agendamento

### Fluxo resumido

```text
Prospect demonstra interesse
  → IA detecta action="schedule"
  → Busca 2 slots (dias diferentes) no Cal.com
  → Envia mensagem: "Tenho 2 horários disponíveis: [slot1] e [slot2]. Qual prefere?"
  → Reserva os 2 slots (hold de 2h)
  
  SE responde em 2h → confirma 1 slot, cancela o outro
  SE NÃO responde em 2h →
    → Cancela os 2 holds
    → Identifica canal mais usado (exceto telefone)
    → Envia: "Os horários foram ocupados. Acesse [link] para escolher outro."
```

### Escopo
- 3 secrets (API Key, Event Type ID, Booking Link)
- 1 migração (tabela `slot_holds`)
- 2 novas edge functions (`calcom-slots`, `expire-slot-holds`)
- 2 edge functions atualizadas (`inbound-webhook`, `cadence-executor`)
- 1 página atualizada (Integrations — card Cal.com)

