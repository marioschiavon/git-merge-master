# Responder perguntas esclarecedoras (duração, formato etc.) sem rejeitar slots

## Problema
Na conversa do Ju, depois de oferecermos novos horários, ele perguntou de novo "Quanto tempo é de reunião?". O SDR ignorou a pergunta e respondeu "Poderia me dizer o dia e horário exato de sua preferência?" — fallback do `suggest_meeting_times` quando a busca de slots falha.

Por que: o `slotContext` que vai pro AI quando há slots reservados (ou agendamento em curso) **só permite as ações** `confirm_slot` / `reject_slots` / `check_availability`. Não há saída para "o lead só está fazendo uma pergunta". Resultado: o AI escolhe a ação errada e a resposta sai sem relação com a pergunta.

## Solução

### 1. `supabase/functions/inbound-webhook/index.ts` (slotContext)
- Buscar a duração da reunião do Cal.com via `getMeetingDurationMinutes(supabase, companyId)` (helper já existente em `_shared/meeting-duration.ts`).
- Em todos os três ramos do `slotContext` (≥2 slots, 1 slot, schedulingInProgress) adicionar bloco:
  ```
  DURAÇÃO DA REUNIÃO: {N} minutos (informe APENAS se o lead perguntar).
  
  IMPORTANTE — perguntas esclarecedoras:
  Se o lead estiver apenas fazendo uma pergunta sobre a reunião
  (quanto tempo dura, qual o formato, presencial ou online,
  quem vai participar, qual o objetivo, é gravada etc.),
  use action = "reply" e responda DIRETAMENTE a pergunta.
  NÃO escolha confirm_slot / reject_slots / check_availability
  nessa situação — mantenha os horários oferecidos intactos.
  ```
- A duração vira variável real no prompt; quando não houver default no Cal.com, omitir o "(N min)" e instruir a IA a responder algo como "rapidinho, no máximo meia hora".

### 2. `supabase/functions/classify-intent/index.ts`
Adicionar sub-intents na categoria `scheduling` para observabilidade/logs (não muda routing):
- `asks_duration`, `asks_format`, `asks_attendees`, `asks_location`, `asks_objective`

E reforçar no system prompt:
> "Mensagens como 'quanto tempo dura?', 'quanto tempo de reunião?', 'é online ou presencial?', 'quem participa?' são **clarifying questions**, não `asks_time_options`. Use o sub-intent específico (`asks_duration`, `asks_format`, ...)."

### 3. Sem mudanças
- Não mexer em `intent_action_rules` (a guard fica no prompt do AI reply).
- Não mexer em UI nem schema.

## Fora de escopo
- Roteamento por sub-intent específico no DB.
- Resposta determinística (hard-coded) sem passar pela IA — preferimos manter o tom natural.
