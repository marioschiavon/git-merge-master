# Corrigir resposta indevida e respeitar pedido de "contato em X horas"

## Diagnóstico

Lead **Nico** (`35169ba4...`) mandou às 16:54:04:
> *"Recomendo que envie o e-mail daqui umas 4h para que seja o momento mais oportuno..."*

O classifier acertou: `channel_switch / send_by_email` com `entities.datetime = "daqui 4h"`. **Mas o SDR respondeu oferecendo horários de reunião** ("Infelizmente esse horário não está disponível. Que tal uma dessas opções? 📅 sexta 12/06 às 16:00...").

**Causa-raiz** — `inbound-webhook/index.ts:809-814`:

```ts
} else if (extractedDt) {
  console.log("Inbound mentions datetime without keyword — redirecting to check_availability");
  parsed.action = "check_availability";
  ...
}
```

A heurística "se a mensagem menciona datetime sem palavra-chave de agendamento, redireciona pra check_availability" ignora completamente o `intent.category` real. Qualquer "daqui X horas" / "amanhã" / "semana que vem" vira pedido de agendamento, mesmo quando o lead está claramente pedindo OUTRA coisa (mudar canal, adiar contato, rejeição com prazo, etc.).

**Segundo problema:** mesmo que o redirect não tivesse acontecido, hoje não há mecanismo para **honrar o pedido** ("entre em contato comigo daqui 4h por email"). A regra `channel_switch / send_by_email` simplesmente respondeu na hora pedindo o email, sem agendar o envio futuro.

## Correções

### 1. Bug-fix: não sequestrar para `check_availability` quando intent já foi classificado como não-agendamento

`supabase/functions/inbound-webhook/index.ts` (linhas 793-815):

Antes de aplicar a heurística "menciona datetime → check_availability", consultar o `lead_intents_log` recém-criado e **abortar o redirect** quando `category` for um dos seguintes (datetime ali se refere a próximo contato, não a reunião):

- `channel_switch` (qualquer sub_intent)
- `rejection` (sub_intent `no_time`, `try_later`, etc.)
- `info_request` puro sem keyword de agendamento
- `referral`

Manter o redirect apenas quando o intent for `scheduling_request`, `confirmation`, ou similar.

### 2. Honrar "entre em contato em X horas por canal Y"

Quando o classifier retorna `channel_switch` (ou `rejection/try_later`) **com `entities.datetime` futuro**, em vez de responder no ato com pergunta + fluxo padrão de cadência:

a. **Enfileirar ação** em `lead_action_queue`:
   - `action_type = 'schedule_followup'`
   - `scheduled_for = entities.datetime`
   - `params = { channel: 'email'|'whatsapp', source: 'lead_request', original_request: <texto>, requested_at: now() }`

b. **Pausar a cadência** automática para esse lead até `scheduled_for` (`cadence_enrollments.next_execution_at = scheduled_for + 1min` + flag em `paused_reason`).

c. **Responder na hora com confirmação curta**, gerada pela IA, ex.:
   > *"Combinado, Nico — te mando o resumo por e-mail daqui ~4h então. Até já 👋"*
   
   Sem oferecer horários, sem pedir email novamente (se já tiver).

d. **Logar `lead_activities`** tipo `note`: `⏰ Lead pediu contato em <horário> via <canal>`.

### 3. Processador da fila no `intent-cron` / `execute-action`

`execute-action` já tem `schedule_followup`. Adicionar/ajustar handler para quando o item da fila vence (`scheduled_for <= now()`):

- Se `params.source === 'lead_request'`: gerar mensagem com a IA usando o `build-first-message` (ou reply contextual) pelo `channel` solicitado, enviar via gmail-send / Z-API, e **retomar** a cadência (`cadence_enrollments.status = 'active'`, `next_execution_at` recalculado).

`intent-cron` já roda a cada minuto e processa `lead_action_queue` pendentes — basta garantir que esse novo caminho passa por lá.

### 4. Limpar resposta indevida do Nico (opcional, manual)

Marcar a sequência 16:54:32 → 16:55:50 como "resposta automática equivocada" em `lead_activities` para auditoria. Não apagar mensagens (preserva histórico real do que o lead recebeu).

## Arquivos tocados

- `supabase/functions/inbound-webhook/index.ts` — guard antes do redirect + novo branch `channel_switch + datetime futuro`
- `supabase/functions/_shared/route-intent.ts` — mapear `channel_switch + datetime` para `schedule_followup` com `scheduled_for` correto
- `supabase/functions/execute-action/index.ts` — handler `schedule_followup` com `source=lead_request` (gera e envia mensagem)
- `supabase/functions/intent-cron/index.ts` — confirmar que processa a fila no horário

## Validação

1. **Simular** mensagem "me chame daqui 2h por email" no Nico → esperar:
   - Sem oferta de horários.
   - Resposta curta de confirmação.
   - `lead_action_queue` com 1 row `schedule_followup` em ~2h.
   - `cadence_enrollments.next_execution_at` empurrado para depois disso.
2. **Avançar relógio** / aguardar → cron envia o email gerado pela IA.
3. **Mensagem "amanhã às 14h"** com intent `scheduling_request` → deve continuar caindo em `check_availability` (regressão).
