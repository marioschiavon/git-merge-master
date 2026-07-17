## O que muda

Hoje o `whatsapp-send-tick` tem um cooldown fixo de 20min por lead que atrasa qualquer novo outbound — inclusive respostas a inbound do lead. Vamos trocar essa regra por:

**Nova regra do worker (`whatsapp-send-tick`):**

1. **Lead respondeu depois do último outbound** → envia normalmente (só respeita jitter/caps/business hours). Sem cooldown.
2. **Lead não respondeu ao último outbound** → o worker **não** enfileira eternamente com cooldown; ele **cancela o item da fila** (`status='skipped'`, motivo `awaiting_lead_reply`) e deixa o **reengajamento da cadência** cuidar disso, com o intervalo/steps que o usuário já configurou em Cadências.

Ou seja: cooldown deixa de ser uma regra hardcoded do worker de 20min — passa a ser regida pela cadência (que o `cadence-reengage-cron` já roda a cada 30min).

## Exceção: aprovações manuais

Quando o item da fila veio de `source='approval'` (usuário clicou "Aprovar" em uma sugestão), o lead-sem-resposta **não** cancela — o usuário decidiu conscientemente enviar aquela msg. Nesse caso o worker envia (só respeita jitter/caps/business hours).

Vale a regra de skip apenas para envios automáticos (`source in ('cadence_step','cadence_step_custom','first_message')`).

## Arquivo alterado

`supabase/functions/whatsapp-send-tick/index.ts` — bloco "Cooldown por lead":

- Remover a busca por outbound recente + o reagendamento `lead_cooldown`.
- Adicionar: buscar última mensagem do lead na conversa (qualquer direção).
  - Última = `inbound` **ou** não existe última outbound recente → envia.
  - Última = `outbound` **e** `source` é automático de cadência → marca `status='skipped'`, `last_error='awaiting_lead_reply'`. Não reagenda.
  - Última = `outbound` **e** `source='approval'` ou `'manual'` → envia.

## Fora de escopo

- Não mexe em pacer (jitter 45-90s), caps hora/dia, warm-up nem business hours — continuam iguais.
- Não altera UI nem hooks.
- Não altera o `cadence-reengage-cron` — ele já respeita a configuração de reengajamento da cadência.

## Efeito prático

- Lead respondeu 10:05 → aprovação de 10:06 sai no próximo tick (~30-90s).
- Lead não respondeu ao step automático → item some da fila; o reengajamento definido na cadência (ex: "4h depois manda step-2") retoma no horário certo, sem sobrepor com regra fixa de 20min.
