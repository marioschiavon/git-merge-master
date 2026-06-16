## Objetivo
Quando uma conversa estiver em **human_takeover** (Inbox humana), **nenhuma** mensagem deve ser enviada para aprovação — o operador está no controle.

## Diagnóstico
Hoje, ao tomar conta da conversa:
- `inbound-webhook`, `sdr-agent` e `sdr-debounce-tick` já pulam o pipeline de IA quando `conversations.human_takeover = true` ✓
- **Mas** `cadence-executor`, `cadence-agent-decide` e `execute-action` ainda podem chamar `shouldGate()` → `createApprovalRequest()` para o mesmo lead, criando aprovações "fantasma" enquanto o humano conversa.

## Mudança
Adicionar um **gate de takeover** centralizado em `supabase/functions/_shared/hitl-gate.ts` e usá-lo nas funções acima.

### 1. `_shared/hitl-gate.ts`
- Nova função `isLeadUnderHumanTakeover(supabase, { lead_id, conversation_id }): Promise<boolean>` que retorna `true` se:
  - a `conversation_id` informada tem `human_takeover = true`, **ou**
  - existe qualquer `conversations` do `lead_id` com `human_takeover = true`.
- `createApprovalRequest()` chama esse helper logo no início e, se `true`, **não cria** a aprovação e retorna `null` (com log claro `[hitl-gate] skipped — human_takeover`).
- `shouldGate()` ganha parâmetros opcionais `{ lead_id?, conversation_id? }`; se sob takeover, retorna `false` direto (assim o caller também não tenta enviar pela IA).

### 2. Call sites — passar contexto para o gate
- `supabase/functions/execute-action/index.ts` (3 chamadas de `shouldGate`): passar `lead_id` e `conversation_id` do contexto.
- `supabase/functions/cadence-executor/index.ts` (2 chamadas): passar `lead_id` do enrollment; quando sob takeover, **pausar o enrollment** com `paused_reason: "human_takeover"` em vez de tentar enviar/aprovar.
- `supabase/functions/cadence-agent-decide/index.ts` (1 chamada): mesma coisa — sob takeover, marcar a decisão como `skipped_human_takeover` e pausar o enrollment.

### 3. Sem mudanças no frontend
O painel humano (`HumanCopilotPanel`, `useSendMessage` → `send-outbound-message`) já envia diretamente sem passar por HITL — nada a ajustar lá.

## Fora de escopo
- Recriar aprovações antigas que ficaram `pending` (ficam como estão; operador pode rejeitar via tela de Aprovações).
- Mudar regras de HITL para conversas sem takeover.

## Resultado esperado
Com a conversa em modo humano, qualquer tentativa de cadência/agent/execute-action de gerar `approval_request` é silenciosamente ignorada e logada; a fila de aprovações não cresce enquanto o operador está conduzindo.