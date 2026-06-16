## Problema

A cadência **inteligente (agentic)** envia mensagem direto de dentro de `cadence-agent-decide` (linhas 525–590) — chama `gmail-send` / Z-API e insere em `messages` **sem passar pelo `sendOutbound`** que tem o gate HITL. Por isso o teste passou pela frente das aprovações.

Existem ainda outros caminhos paralelos que também precisam ser fechados.

## Caminhos que ainda burlam o HITL

| # | Função | Linha | Tipo |
|---|---|---|---|
| 1 | `cadence-agent-decide` | 540–571 | Envia gmail-send + Z-API + insere `messages` direto (**raiz do bug atual**) |
| 2 | `execute-action` → `schedule_followup` (lead_request) | 300 | Invoca `gmail-send` direto |
| 3 | `execute-action` → `send_email` handler | 464 | Invoca `gmail-send` + insere `messages` direto |
| 4 | Conversations UI — botão "Responder com IA" (se existir) | — | Verificar e gatear |

## Plano (cirúrgico, por handler)

### 1. `cadence-agent-decide` — gatear envio agentic
Antes do bloco `decision.action === "send"` real (não na simulação), chamar `shouldGate("cadence_step", company_id)`. Se `true`:
- Criar `approval_request` (`kind: "cadence_step"`, `channel`, `payload: {subject, body, message, hook, attempt}`, `context: {rationale, intent, cadence_id, enrollment_id, lead_id}`)
- **Persistir a `cadence_agent_decisions` mesmo assim** com `status: "pending_approval"` (campo já existente ou usar metadata)
- Pausar enrollment com `paused_reason: "awaiting_approval"` e `next_execution_at = null`
- Registrar `lead_activity` "🕓 Aguardando aprovação humana — IA propôs (canal/hook)"
- **Não chamar gmail-send / Z-API, não inserir `messages`**
- Aceitar parâmetro `bypass_hitl: true` no body para re-execução pós-aprovação

### 2. `execute-action` — fechar bypasses
- **`schedule_followup` (lead_request branch)**: substituir o `functions.invoke("gmail-send")` direto por uma chamada a um helper `sendEmailGated()` que faz o mesmo gate do `sendOutbound`. Mesmo padrão p/ WhatsApp branch (já usa sendOutbound, OK).
- **`send_email` handler**: idem — passar pelo gate antes do `gmail-send` direto.

Refatoração mínima: extrair um helper `sendEmailDirect(ctx, {to, subject, html, body})` que internamente chama `shouldGate("sensitive_action" ou "sdr_reply" conforme contexto)`, cria approval_request se gate ON, ou envia se OFF.

### 3. `approval-execute` — suportar `kind: "cadence_step"` do agentic
Atualizar para, quando aprovado/editado:
- Reativar `cadence_enrollment` (`status: "active"`, `paused_reason: null`)
- Reinvocar `cadence-agent-decide` com `{ enrollment_id, bypass_hitl: true, override_decision: {...payload editado} }`
- Em `cadence-agent-decide`, se receber `bypass_hitl=true` + `override_decision`, pular o LLM e usar a decisão fornecida, indo direto ao bloco de envio.

### 4. UI Conversations
Verificar se há ação "Gerar resposta IA" no `src/pages/Conversations.tsx`. Se sim, garantir que o fluxo chame `sdr-agent` / `execute-action` (que estará gatado). Se chama `generate-reply` direto e envia, plugar o gate também.

### 5. Diagnóstico — log defensivo
Em `_shared/hitl-gate.ts`, adicionar `console.log("[hitl-gate]", { company_id, scope, hitl_enabled, hitl_scopes, decision })` para ficar fácil ver nos logs por que um gate dispara ou não.

## Detalhes técnicos

**Arquivos a editar:**
- `supabase/functions/cadence-agent-decide/index.ts` (principal)
- `supabase/functions/execute-action/index.ts` (2 handlers + helper)
- `supabase/functions/approval-execute/index.ts` (suporte cadence_step agentic)
- `supabase/functions/_shared/hitl-gate.ts` (logs + helper email)
- `src/pages/Conversations.tsx` (verificar/ajustar)

**Sem nova migração** — a `approval_requests` já existe e suporta `kind: "cadence_step"`.

**Compat:** com HITL OFF, comportamento idêntico ao atual.

## Fora de escopo
- Reescrever cadence-agent-decide pra usar sendOutbound centralizado (refactor maior, fica pra depois)
- Magic links de aprovação por email/WhatsApp
- Aprovação por confiança automática