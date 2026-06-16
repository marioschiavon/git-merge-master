## Visão geral

Criar um modo **Human-in-the-Loop ativo**: cada conversa ganha um toggle "Humano on/off". Quando ligado (manual ou via rejeição em Aprovações), a IA para de enviar sozinha mas continua trabalhando como copiloto. O operador ganha um painel lateral com ferramentas rápidas (gerar resposta, ofertar slots, agendar, cancelar, reagendar) e uma inbox dedicada `/inbox` para gerenciar todos os chats em modo humano com SLA visual.

## 1. Modelo de dados

Adicionar à tabela `conversations`:
- `human_takeover` boolean default false
- `human_taken_at` timestamptz
- `human_taken_by` uuid (auth.users)
- `human_takeover_reason` text ('manual' | 'rejected_approval' | 'sla_breach')
- `last_inbound_at` timestamptz (índice — usado para SLA)
- `sla_status` computed no frontend (verde <5min, amarelo 5-15, vermelho >15)

Em `approval_requests`: já existe rejeição — só adicionar hook que ao rejeitar marque `conversations.human_takeover = true` e registre o motivo.

## 2. Backend — pausa da IA

**`sdr-agent/index.ts`** (guarda no início do run):
```ts
if (conversation.human_takeover) {
  await logEvent('sdr_skipped_human_takeover');
  return { skipped: true };
}
```

**`sdr-debounce-tick`** e **`cadence-executor`**: mesma guarda — não enviam outbound em conversa com `human_takeover=true`.

**Webhooks de inbound** (twilio, zapi, gmail, inbound-email): continuam salvando mensagens normalmente e atualizando `last_inbound_at`, mas não disparam `sdr-agent` se takeover estiver ligado.

## 3. Edge functions novas (reaproveitam lógica existente)

- **`human-suggest-reply`** — recebe `conversation_id`, monta histórico + knowledge + intent e devolve resposta sugerida (reusa `ai-reply` + `_shared/history-builder`).
- **`human-offer-slots`** — wrapper de `calcom-slots` que devolve 2-3 horários formatados prontos para inserir no chat.
- **`human-book-slot`** / **`human-cancel-booking`** / **`human-reschedule-booking`** — wrappers finos das funções `calcom-booking-*` já existentes, mas chamadas com `actor='human'` para logging.
- **`human-return-to-ai`** — seta `human_takeover=false`, registra evento, e dispara `sdr-agent` se houver mensagem inbound pendente.

Reutilizamos `send-outbound-message` para envio (já existe).

## 4. UI — Toggle em cada conversa

Em `src/pages/Conversations.tsx` (header do chat selecionado):
- Switch "🤖 Auto / 👤 Humano" com badge do operador que assumiu
- Tooltip: "IA pausada — você está no controle"
- Botão "Devolver para IA" quando ligado

## 5. UI — Painel do operador (novo componente)

`src/components/inbox/HumanCopilotPanel.tsx` — drawer/coluna direita no chat quando `human_takeover=true`:

```text
┌─────────────────────────────┐
│ 🧠 Copiloto IA              │
├─────────────────────────────┤
│ [Gerar resposta com IA]     │ → preenche composer
│ [Sugerir 3 horários]        │ → insere texto + cria slot_holds
│ [Agendar agora ▾]           │ → modal com slots
│ [Cancelar reunião]          │ → confirma e chama cancel
│ [Reagendar]                 │
├─────────────────────────────┤
│ Snippets rápidos            │
│ • Apresentação              │
│ • Materiais                 │
│ • Follow-up                 │
├─────────────────────────────┤
│ Última intenção: agendar    │
│ Lead: João — Empresa X      │
│ Booking ativo: 18/06 14h    │
└─────────────────────────────┘
```

Todas as ações executam direto e logam em `lead_activities` com `actor='human'`.

## 6. UI — Inbox dedicada `/inbox`

Nova rota `src/pages/Inbox.tsx`:
- Lista de conversas com `human_takeover=true`, ordenadas por `last_inbound_at` desc
- Cada item: avatar do lead, prévia da última msg, timer "há Xmin", badge SLA (🟢🟡🔴), canal, motivo do takeover
- Filtros: "Meus" (assumidos por mim) / "Time" (todos) / "Não atribuídos"
- Layout 3 colunas: lista | chat | copiloto
- Header com contadores: "12 aguardando · 3 SLA estourado"
- Realtime via Supabase subscription em `messages` e `conversations`

Adicionar em `AppSidebar` com badge de contagem de não respondidos.

## 7. Integração com Aprovações

Em `src/pages/Approvals.tsx` — ao rejeitar:
- Modal: "Assumir conversa manualmente?" (default sim)
- Se sim: marca `human_takeover=true` + `reason='rejected_approval'` + `human_taken_by=user.id` e navega para `/inbox?conversation=<id>`

## 8. SLA e timers

Componente `<SLABadge lastInboundAt={...} />`:
- <5min: verde "respondendo"
- 5-15min: amarelo "atenção"
- >15min: vermelho "urgente"
- Tick a cada 30s via `useEffect`

## Detalhes técnicos

- **RLS**: políticas em `conversations` já filtram por `company_id`; adicionar coluna não muda. Edge functions `human-*` validam JWT e checam `company_id` do user vs conversation.
- **Race condition**: ao ligar takeover, cancelar `pending_inbound_runs` da conversa para evitar IA respondendo no meio.
- **Devolver para IA**: limpa `human_taken_by/at`, e se houver inbound não respondido nas últimas 24h, enfileira `sdr-agent` para retomar.
- **Logging**: toda ação humana grava em `lead_activities` (type='human_action') e `cadence_agent_decisions` (actor='human') para manter histórico unificado.
- **Realtime**: usar `supabase.channel()` em `/inbox` para `messages` insert e `conversations` update.

## Arquivos a criar/editar

**Novos:**
- `src/pages/Inbox.tsx`
- `src/components/inbox/HumanCopilotPanel.tsx`
- `src/components/inbox/InboxList.tsx`
- `src/components/inbox/SLABadge.tsx`
- `src/hooks/useHumanTakeover.ts`
- `src/hooks/useInboxQueue.ts`
- `supabase/functions/human-suggest-reply/index.ts`
- `supabase/functions/human-offer-slots/index.ts`
- `supabase/functions/human-book-slot/index.ts`
- `supabase/functions/human-cancel-booking/index.ts`
- `supabase/functions/human-reschedule-booking/index.ts`
- `supabase/functions/human-return-to-ai/index.ts`
- Migration: colunas em `conversations`

**Editados:**
- `src/App.tsx` (rota `/inbox`)
- `src/components/AppSidebar.tsx` (item Inbox com badge)
- `src/pages/Conversations.tsx` (toggle humano + painel)
- `src/pages/Approvals.tsx` (hook ao rejeitar)
- `supabase/functions/sdr-agent/index.ts` (guarda takeover)
- `supabase/functions/sdr-debounce-tick/index.ts` (guarda)
- `supabase/functions/cadence-executor/index.ts` (guarda)
- Webhooks inbound (não disparar SDR se takeover)

## Fora de escopo

- Atribuição automática a operadores (fica em "Todos" por enquanto)
- Notificações push/email de SLA estourado
- Métricas/relatório de tempo de resposta humano
- Templates/snippets editáveis (versão 1 usa snippets hardcoded; gestão fica para depois)
