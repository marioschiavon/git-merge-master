## Problema

Quando um lead responde e a conversa está ativa, a resposta do SDR (com ou sem HITL) hoje entra no **fim da fila** do WhatsApp, atrás de todos os disparos frios pendentes, e ainda respeita janela comercial + caps hora/dia. Resultado: leads que responderam ficam sem resposta por 10h+, e às vezes só recebem no próximo dia útil.

Além disso, ao clicar "Aprovar" no painel de Aprovações, o sistema marca a aprovação como executada imediatamente — mas a mensagem ainda está na fila e pode nem ter saído. A UI mostra "enviada" mesmo quando nada saiu (falso positivo).

## Causa raiz (verificada em código)

1. `_shared/whatsapp-pacer.ts` (linhas 68–96): `scheduled_for = max(agora, último_pending_da_instância) + gap(45–90s)`. Não há prioridade — resposta a lead engajado fica no fim.
2. `approval-execute/index.ts` (linhas 265–306): enfileira via pacer com `source: "approval"` e imediatamente grava `status = approved`, `executed_at = now()`. O status reflete "aprovação clicada", não "mensagem entregue".
3. `whatsapp-send-tick/index.ts` (linhas 108–153): janela de envio e caps hora/dia são aplicados uniformemente a todos os itens da fila — inclusive respostas a leads engajados que deveriam sair na hora.

## Solução

### 1. Coluna de prioridade

**Migration:** `whatsapp_send_queue.priority smallint default 0` (`0` = normal, `10` = alta). Índice parcial `(status, priority desc, scheduled_for)` para o cron pegar as altas primeiro. Também adicionar `queued_at timestamptz` em `approval_requests` para o novo ciclo de vida.

### 2. Pacer detecta "modo resposta"

Em `enqueueWhatsAppSend`, marcar `priority = 10` e usar `scheduled_for = agora + jitter curto (3–10s)`, **ignorando** o `lastPending`, quando qualquer condição for verdadeira:

- Parâmetro explícito `replyMode: true` (usado por `approval-execute` quando `approval.kind === 'sdr_reply'` ou `'sensitive_action'`).
- A última mensagem daquele lead no canal `whatsapp` é `direction = 'inbound'` (checagem automática dentro do pacer).

Cold outbound (cadência, first_message sem inbound anterior) continua com `priority = 0` e o gap normal.

### 3. Send-tick respeita prioridade e libera lead engajado

- Ordenar a fila por `priority desc, scheduled_for asc`.
- Itens com `priority >= 10`:
  - **Pulam** checagem de business hours.
  - **Pulam** caps hora/dia (conforme decisão do usuário: resposta a inbound não sofre janela nem cap — WhatsApp não pune resposta a conversa ativa).
  - Continuam respeitando: instância conectada, retry em falha, `MAX_ATTEMPTS`.
- Itens com `priority = 0`: comportamento atual inalterado (janela, caps, warm-up, skip "awaiting_lead_reply").

### 4. Corrigir falso positivo "enviado" no fluxo de Aprovações

Novo ciclo de vida em `approval_requests`:

- `approval-execute` ao enfileirar com sucesso: `status = 'queued'`, `queued_at = now()`, guarda `queue_id` em `context`. **Não** seta `executed_at`.
- `whatsapp-send-tick` ao enviar com sucesso: se o item tem `approval_id`, atualiza a aprovação para `status = 'approved'` (ou `'edited_sent'` se veio editada), `executed_at = now()`; move o insert da activity "✅ Aprovação enviada" para esse ponto.
- Se o envio falhar definitivamente (`MAX_ATTEMPTS` esgotado): `status = 'failed'`, `execution_error = <erro>`, activity "⚠️ Falha no envio".
- Frontend (`useApprovals` + `pages/Approvals.tsx`): chip "Na fila" quando `status = 'queued'`, "Enviada" quando `executed_at != null`, "Falhou" quando `status = 'failed'`. Tooltip com `scheduled_for` para o operador saber quando sai (útil quando estiver com priority=0 e caps cheios).

### 5. Mensagens humanas na Inbox

`send-outbound-message` (mensagem escrita à mão pelo operador) já envia direto via `sendWhatsAppViaHook7`, sem passar pela fila — mantém, é o caminho certo. Nenhuma mudança aqui.

## Arquivos afetados

- `supabase/migrations/<novo>.sql` — `priority` em `whatsapp_send_queue`, índice, `queued_at` em `approval_requests`, permitir `status='queued'` e `status='failed'` na check constraint (se existir).
- `supabase/functions/_shared/whatsapp-pacer.ts` — parâmetro `replyMode`, detecção automática por última msg inbound, `priority`, jitter curto.
- `supabase/functions/approval-execute/index.ts` — passa `replyMode: true` quando `kind ∈ {sdr_reply, sensitive_action}`; grava `status='queued'`/`queued_at` em vez de `executed_at=now()`; remove o insert da activity "✅ Aprovação enviada" (vai para o tick).
- `supabase/functions/whatsapp-send-tick/index.ts` — ordena por `priority desc, scheduled_for asc`; bypass de business hours e caps para `priority >= 10`; fecha ciclo do approval no sucesso (grava `executed_at`, activity) e na falha definitiva (`status='failed'`, `execution_error`, activity).
- `src/hooks/useApprovals.ts` e `src/pages/Approvals.tsx` — estados "Na fila" / "Enviada" / "Falhou" + tooltip com `scheduled_for`.

## Como validar

1. Lead com última msg `inbound`: criar aprovação `sdr_reply` → item entra com `priority=10`, `scheduled_for ≤ 10s` à frente. Rodar tick manual: mensagem sai; approval fica `executed_at != null`, chip "Enviada".
2. Mesmo cenário, mas fora do horário comercial e com caps do dia estourados: mensagem ainda sai imediatamente.
3. Fila lotada de cadência fria (priority=0): ao aprovar um `sdr_reply`, o item novo passa na frente dos frios no próximo tick.
4. Instância desconectada por 3 tentativas: approval vira `status='failed'`, chip "Falhou", activity registra o erro.
5. Cadência fria disparada 22h de sexta com janela seg–sex 09–18: continua reagendando para segunda 09h (comportamento atual preservado).