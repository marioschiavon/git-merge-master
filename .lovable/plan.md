## Diagnóstico

Olhando a conversa do Juliano (lead `61a9b13e…`):

- **13:32:10 / 13:32:16 / 13:32:24** — 3 mensagens inbound em 14 segundos ("Sim. Eu não podia…", "Você tem algum outro?", "Para próxima semana?").
- **13:32:59 / 13:33:01 / 13:33:18** — 3 respostas do SDR, cada uma com 2 horários diferentes → o lead recebeu **6 horários** em ~20s.

### Causa raiz

1. **`inbound-webhook`** dispara `sdr-agent` em fire-and-forget a CADA mensagem recebida (linha 452–470). Não há janela de espera nem coalescência. Três inbounds em paralelo = três execuções concorrentes do agente.
2. **`sdr-agent`** não tem lock por lead. Cada execução chama `check_calendar` independentemente, e `calcom-slots` exclui apenas slots já reservados em `slot_holds` — não slots oferecidos segundos antes. Resultado: cada turno propõe 2 horários novos que não conflitam com os anteriores ainda não persistidos.
3. Não há limite acumulado de "quantos horários já ofereci nesta conversa sem o lead escolher".

## Plano

### 1. Debounce de mensagens inbound (coalescência)

Objetivo: aguardar ~10–12s após cada inbound antes de responder; se chegar nova mensagem dentro da janela, reinicia o timer e o agente processa todas juntas.

Implementação (sem depender de processo persistente):

- Nova tabela `pending_inbound_runs`:
  ```
  lead_id uuid PK, conversation_id uuid, company_id uuid,
  scheduled_at timestamptz, last_inbound_at timestamptz,
  status text ('pending'|'running'|'done'), attempts int
  ```
- Em `inbound-webhook`, depois de gravar a mensagem inbound, em vez de invocar `sdr-agent` direto:
  - `upsert` em `pending_inbound_runs` com `scheduled_at = now() + 12s` e `last_inbound_at = now()` (sempre estende — debounce de "trailing edge").
  - **Não** invoca `sdr-agent` agora.
- Novo cron `sdr-debounce-tick` (a cada 10s, via `pg_cron`/scheduled function) que:
  - Seleciona registros `status='pending'` com `scheduled_at <= now()`.
  - Faz `UPDATE … SET status='running' WHERE status='pending'` com `RETURNING` (lock atômico).
  - Invoca `sdr-agent` uma única vez por lead com `trigger='inbound_batch'`.
  - Marca `done` ao fim (ou re-`pending` em erro com backoff).
- Alternativa mais simples (sem cron): após o `upsert`, em background (`EdgeRuntime.waitUntil`) faz `await sleep(12_000)` e então, se `last_inbound_at` na tabela == o que vimos, dispara o agente. Funciona mas depende de a edge function não ser encerrada — uso recomendado: combinar com cron como fallback.

### 2. Lock por lead no `sdr-agent`

- No início de `sdr-agent` adquirir `pg_try_advisory_xact_lock(hashtext('sdr:'||lead_id))` (ou row-lock em `sdr_agent_runs`).
- Se já houver execução em andamento, retorna `skipped: true` em vez de rodar em paralelo. Evita corrida mesmo se algo escapar do debounce.

### 3. Limitar e reaproveitar horários oferecidos

- Em `lead_memory` (ou novo campo), manter `offered_slots_pending`: lista de slot ISO oferecidos nos últimos N minutos e ainda não escolhidos/recusados.
- No `sdr-agent`, antes de oferecer novos:
  - Se `offered_slots_pending` já tem ≥ 3 horários e nenhum foi rejeitado explicitamente, **não** chamar `check_calendar` de novo. Em vez disso, repetir/relembrar os 2 melhores já oferecidos ("Os horários que te passei foram X e Y — algum deles funciona?") ou pedir uma janela ("Me diga um período da semana que prefere").
  - Se o lead rejeitou (sub_intent `rejects_slot` / "não posso nesses"), **limpar** a lista e oferecer no máximo 2 novos.
- Reduzir `nextAvailable.slice(0, 4)` para `slice(0, 2)` na fallback de janela vazia (sdr-agent linha 280) — já que a mensagem final só usa 2.
- Adicionar regra explícita no prompt do agente: "Nunca ofereça mais de 2 horários por turno. Se já ofereceu 4 nos últimos 10 min sem resposta de aceite/recusa, pare de oferecer novos e peça a janela preferida."

### 4. Passar contexto agregado para o agente

Quando o debounce dispara o agente após coalescer N mensagens, o prompt deve receber o histórico já com as 3 últimas inbound juntas (já acontece via fetch de mensagens — basta garantir que o agente leia as mensagens posteriores ao último outbound como um único bloco no system/user message: "O lead enviou em sequência: …").

## Detalhes técnicos

**Arquivos a alterar**
- `supabase/migrations/<new>.sql` — criar `pending_inbound_runs` + GRANTs + RLS (service_role) + índice em `(status, scheduled_at)`.
- `supabase/functions/inbound-webhook/index.ts` (linhas 447–474) — substituir invoke direto por upsert no debounce + waitUntil opcional.
- `supabase/functions/sdr-debounce-tick/index.ts` (novo) — cron a cada 10s.
- `supabase/config.toml` — agendar cron.
- `supabase/functions/sdr-agent/index.ts` — adicionar lock advisory, reduzir `slice(0,4)` → `slice(0,2)`, ler/escrever `offered_slots_pending`, novas regras no system prompt.
- `supabase/functions/calcom-slots/index.ts` — aceitar `exclude_datetimes` vindo dos pending recentes (já aceita; só garantir uso).

**Fora de escopo**
- Mudar tom/conteúdo do SDR além das regras de quantidade de horários.
- Refator do pipeline legacy não-agent.
- Realtime/UI de "digitando…" para o lead.

## Pergunta de calibração

Janela de debounce sugerida: **12 segundos** (tempo típico de quem digita em 2–3 mensagens). Posso usar esse valor, ou prefere 8s/20s? E o teto de horários oferecidos por turno: confirmo **2**?
