## Diagnóstico

Histórico da Juju2:
1. Reunião confirmada às 11:34:29 (system message `booking_confirmed`).
2. Lead responde "Obrigado" às 11:34:58.
3. SDR responde às 11:35:10: *"Poderia me dizer o dia e horário exato de sua preferência? Assim consigo verificar a disponibilidade."* — pedindo agendamento de novo.

Causa:
- `classify-intent` rotulou "Obrigado" como `scheduling / confirms_attendance` (categoria errada, mas plausível).
- O AI do `inbound-webhook` retornou `action: "check_availability"` sem `suggested_datetime`. Sem data, o fallback em `inbound-webhook/index.ts` linha 778-780 cospe a frase "Poderia me dizer o dia e horário...".
- O prompt já tem `confirmedBookingBlock` ensinando o AI a usar `reschedule`/`cancel` quando há reunião confirmada, mas **não cobre o caso de acknowledgment puro** ("obrigado", "valeu", "até lá", "perfeito") — então o viés do "OBJETIVO PRINCIPAL: sempre agendar" empurra para `check_availability`.
- Não há guarda determinístico que bloqueie ações de scheduling quando já existe `slot_holds.status='confirmed'` e a mensagem é apenas acknowledgment.

## Correção

### 1. Reforço no prompt (`supabase/functions/inbound-webhook/index.ts`)
No `confirmedBookingBlock` (linha ~537-539), acrescentar regra explícita:

> Se a mensagem do prospect for apenas agradecimento/confirmação social ("obrigado", "valeu", "ok", "perfeito", "até lá", "combinado") e já existe reunião confirmada → use `action = "reply"` com uma resposta curta e amigável (ex.: "Combinado, até lá!"). NÃO use `schedule`, `check_availability` nem `suggest_meeting_times`.

### 2. Guarda determinístico pós-AI (`inbound-webhook/index.ts`)
Logo após os guards de scheduling existentes (depois da linha ~768, antes do bloco de `check_availability` fallback na linha 771):

- Se `confirmedSlotForPrompt` existe (lead já tem booking confirmado) E `parsed.action ∈ {check_availability, schedule, suggest_meeting_times}` E o `cleanContent` NÃO contém keywords de remarcar/cancelar (`remarcar|reagendar|mudar|trocar|cancelar|nao vou poder|não vou poder|outro horario|outro horário`) → forçar `action = "reply"` e gerar reply curto via fallback (ex.: "Combinado! Até lá."). Logar a decisão.

Isso elimina o risco de qualquer fallback (linha 779, 794, etc.) ser acionado quando a reunião já está confirmada e o lead só está sendo cordial.

### 3. (Opcional, mesmo arquivo) Pequeno ajuste na detecção de keywords
Adicionar set `ACK_PATTERNS = /\b(obrigad[oa]|valeu|ok|perfeito|combinado|até\s+lá|ate\s+la|show|beleza|legal|👍)\b/i` para identificar acknowledgments rapidamente e usar tanto no guard acima quanto, em fallback de último recurso, gerar reply "Combinado! Até lá 👋" em vez da pergunta sobre horário.

## Fora de escopo
- Não mexer em `intent_action_rules` nem no `classify-intent`. A regra wildcard de scheduling continua existindo; o guard pós-AI no `inbound-webhook` é suficiente para o cenário relatado.
- Não alterar UI de `/conversations`.
- Não tratar mensagens de acknowledgment quando NÃO há booking confirmado (comportamento atual permanece).

## Validação
1. Lead com booking confirmado responde "Obrigado" → SDR responde "Combinado! Até lá 👋" (ou similar). Sem nova oferta de horário.
2. Lead com booking confirmado responde "preciso remarcar para terça às 14h" → continua indo para `reschedule` (palavra-chave detectada, guard não atua).
3. Lead sem booking confirmado responde "obrigado pelas infos" → comportamento atual mantido (AI livre).
