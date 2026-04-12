

## Corrigir mensagem com apenas 1 data e problemas de fluxo pós-confirmação

### Diagnóstico

Analisando os dados, identifiquei **2 problemas distintos**:

**Problema 1 — Mensagem com apenas 1 data:**
Quando o lead respondeu "Tudo bem? Gostaria de entender como isso funciona" (às 02:58), o sistema:
1. Não encontrou slot_holds com status `held` (já estavam confirmed/cancelled da interação anterior)
2. A IA retornou `action: "schedule"` e gerou sua própria `reply_message` com 1 data
3. O sistema chamou `calcom-slots` para buscar 2 slots, mas o Cal.com provavelmente só tinha 1 slot disponível (pois o slot de segunda 13/04 já estava reservado como booking definitivo)
4. Como `formatted?.length < 2`, o sistema NÃO sobrescreveu a mensagem da IA — e a mensagem da IA mencionava apenas 1 data

**Problema 2 — Cadence-executor continuou enviando mensagens após reunião confirmada:**
O `calcom-confirm-booking` deveria ter marcado o enrollment como `completed` e `meeting_scheduled = true`, mas o enrollment ainda está com `status: paused`, `meeting_scheduled: false`. Isso fez o cadence-executor enviar mais mensagens de follow-up mesmo com reunião já agendada.

### Mudanças

**1. `inbound-webhook/index.ts` — Sempre usar os 2 slots do sistema (nunca da IA)**

Na ação `schedule` (linha ~448), IGNORAR `parsed.reply_message` e sempre substituir pela mensagem formatada do sistema:
- Se `calcom-slots` retorna 2+ slots: usar template com 2 opções (já funciona)
- Se retorna 1 slot: oferecer o slot único + perguntar se funciona
- Se retorna 0 ou falha: usar o link do Cal.com como fallback

**2. `calcom-confirm-booking/index.ts` — Garantir atualização do enrollment**

Verificar e corrigir a lógica que marca o enrollment como `completed` + `meeting_scheduled = true`. O enrollment atual mostra que isso não está funcionando. Possíveis causas:
- O enrollment_id não está sendo encontrado na slot_holds
- A query de update está falhando silenciosamente

**3. `inbound-webhook/index.ts` — Bloquear schedule se meeting_scheduled=true**

Antes de executar `action: "schedule"`, verificar se o enrollment já tem `meeting_scheduled = true`. Se sim, responder ao lead sem tentar agendar novamente.

### Escopo
- 2 edge functions atualizadas (`inbound-webhook`, `calcom-confirm-booking`)
- Nenhuma mudança de banco

