## Problema
A conversa mostra 4 slots reservados — mas são apenas 2 datas únicas, cada uma duplicada (sex 03/07 16:00 ×2 e seg 06/07 17:00 ×2). Causa: o agente chamou `check_calendar` duas vezes na mesma run (provavelmente uma para "verificar disponibilidade" e outra para "buscar opções"), e cada chamada do `calcom-slots` faz hold + insert sem deduplicar.

## Plano

### 1. Deduplicar em `calcom-slots/index.ts`
Antes de fazer hold/insert de um slot:
- Buscar `slot_holds` existentes para `(lead_id, slot_datetime)` com status `held` ou `confirmed` e `expires_at > now()`.
- Se já existe, pular reserva no Cal.com e pular insert; retornar o hold existente.
- Aplicar tanto no fluxo normal quanto no `check_datetime`/alternatives.

### 2. Endurecer prompt do `sdr-agent`
Adicionar regra:
- "Chame `check_calendar` no máximo UMA vez por turno. Se já chamou e recebeu slots, use esses mesmos — não chame de novo na mesma decisão."
- "Antes de chamar `check_calendar`, verifique se `heldSlots` já contém slots ativos na janela desejada. Se sim, ofereça esses em vez de pedir novos."

### 3. (Opcional) Cleanup retroativo
Não vou apagar dados existentes — só evitar daqui pra frente.

## Arquivos
- `supabase/functions/calcom-slots/index.ts` — dedupe pré-insert.
- `supabase/functions/sdr-agent/index.ts` — regra extra no prompt.

## Fora de escopo
- UI no SlotHoldsCard agrupando duplicatas visualmente (resolveremos via backend).
- Cancelar duplicatas já existentes no Cal.com.