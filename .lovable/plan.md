## Problema observado

Lead pediu para agendar **daqui a 3 semanas**. O agente respondeu apenas "vou entrar em contato" e, em turnos próximos, ainda ofereceu datas **fora da janela** pedida (datas próximas). Dois bugs reais:

### Bug 1 — Live mode não implementa `offer_slots` / `book_slot`
Em `supabase/functions/sdr-agent/index.ts` (linhas 711-716), quando o agente decide `offer_slots` ou `book_slot`, o live mode grava `live_action_not_implemented` e **nada é enviado ao lead**. O agente, "sabendo" que offer_slots não funciona, acaba caindo em `send_message` genérico ("entraremos em contato") ou `schedule_followup` (que também não envia nada). Resultado: lead fica no vácuo.

### Bug 2 — Janela de datas não é pré-extraída
O agente depende 100% do LLM para parsear "3 semanas" e chamar `check_calendar` com `start_after`. Quando o LLM erra, ele acaba sugerindo slots da semana atual. Já existe `_shared/date-range.ts` que parseia "daqui a X dias", "semana que vem", "próxima segunda" etc., mas o sdr-agent **não usa**. Falta também "3 semanas" / "X semanas" no parser.

---

## Plano

### 1. Implementar `offer_slots` em live mode (sdr-agent/index.ts)
Quando `decision === "offer_slots"`:
- Se o agente já incluiu `message` com as datas formatadas, enviar via `execute-action` (`send_reply`) — os slots já estão segurados porque o agente chamou `check_calendar` antes, que internamente faz hold via `calcom-slots`.
- Se `message` estiver vazio, gerar texto padrão a partir de `offered_slots` (formatado em BRT) e enviar.
- Marcar `liveResult = { action: "offer_slots", ok: true, sent: true }`.

Quando `decision === "book_slot"`:
- Chamar `calcom-booking-create` com `slot_start`, depois enviar mensagem de confirmação via `execute-action`.

### 2. Pré-extrair janela de datas antes do LLM (sdr-agent/index.ts)
- Estender `_shared/date-range.ts` para reconhecer **"daqui a N semanas"** e **"em N semanas"** (start_after = hoje+N*7d).
- No início do `sdr-agent`, pegar a última mensagem inbound, rodar `extractDateRangeFromText`, e se retornar algo NOVO (diferente do que já está em `facts.date_preference`):
  - Mesclar em `lead_memory.facts.date_preference` automaticamente (antes de chamar o LLM).
  - Assim o bloco "⚠️ JANELA DE DATAS PREFERIDA" já aparece no prompt do turno atual.

### 3. Endurecer regras do prompt (sdr-agent/index.ts, buildSystemPrompt)
- Adicionar regra explícita: **"Se existe `date_preference`, é PROIBIDO usar `schedule_followup` ou responder 'entraremos em contato'. Você DEVE chamar `check_calendar` com `start_after`/`end_before` e finalizar com `offer_slots` (ou `send_message` contendo os horários)."**
- Adicionar regra: **"NUNCA ofereça slots fora da janela `date_preference`. Se `check_calendar` retornar slots fora dela, descarte e reexecute com janela correta."**

### 4. Mostrar status real em Agent Runs (src/pages/AgentRuns.tsx)
Quando `final_output.live.action === "offer_slots"` e `sent === true`, mostrar badge "✓ Slots enviados" em vez de só "LIVE".

---

## Detalhes técnicos

**Arquivos alterados:**
- `supabase/functions/_shared/date-range.ts` — adicionar regex para "N semanas".
- `supabase/functions/sdr-agent/index.ts` — pré-extração de date_preference, novas regras no prompt, implementação de `offer_slots`/`book_slot` em live.
- `src/pages/AgentRuns.tsx` — badge de envio confirmado.

**Sem migrations.** Sem mudanças em `inbound-webhook` (a bifurcação já funciona).

**Risco:** o agente vai começar a enviar mensagens com slots de verdade. Continue testando só nos leads marcados como "Agente".

---

## Fora de escopo
- Mudar o default de novos leads para `agent`.
- Implementar `confirm_slot`/`reject_slots` (esses ficam para depois — hoje o agente não escolhe esses decisions).
- Re-treinar o LLM para nunca errar parsing de data (cobrimos com pré-extração + regra dura).