# Plano — Human-in-the-Loop (HITL)

Objetivo: permitir que um humano aprove, edite ou rejeite cada mensagem/ação da IA antes de sair, durante a fase de testes. Quando se sentir confiante, basta desligar a chave global.

## 1. Configuração global por empresa

- Adicionar coluna `hitl_enabled boolean default false` em `companies`.
- Adicionar coluna `hitl_scopes jsonb default '{"first_message":true,"sdr_reply":true,"cadence_step":true,"sensitive_action":true}'` para granularidade futura (UI mostra 4 switches).
- Tela: `Settings → Operação` com toggle "Revisão humana antes de enviar" + 4 sub-switches por escopo.

## 2. Tabela `approval_requests`

Centraliza tudo o que está pendente de revisão.

```text
id uuid pk
company_id uuid
lead_id uuid
conversation_id uuid null
enrollment_id uuid null
kind text       -- 'first_message' | 'sdr_reply' | 'cadence_step' | 'sensitive_action'
channel text    -- email | whatsapp | linkedin | system
action text     -- send | reschedule | cancel | remove_participant | stop | handoff
payload jsonb   -- { subject, body, to, scheduled_at, ... } editável
context jsonb   -- rationale da IA, intent detectado, histórico curto
status text     -- pending | approved | rejected | edited_sent | expired
reviewed_by uuid null
reviewed_at timestamptz null
edited_payload jsonb null
created_at, updated_at
```

RLS por `company_id` + GRANTs padrão. Sem auto-expiração — fica pendente indefinidamente conforme escolha do usuário.

## 3. Ponto de interceptação (gate único)

Criar `_shared/hitl-gate.ts` com `requireApprovalOrSend(params)`:

- Se `hitl_enabled=false` para a `company` → envia normalmente (comportamento atual).
- Se `true` → cria `approval_request` com `status=pending`, registra `lead_activity` "Aguardando aprovação humana", e **não envia**.

Chamar o gate em:
- `cadence-executor` (envio da primeira mensagem e steps determinísticos).
- `cadence-agent-decide` (decisões agentic: send/stop/handoff vira pending).
- `sdr-agent` (resposta a inbound antes do `send-outbound-message`).
- `execute-action` (reschedule/cancel/remove participante do Cal.com).

## 4. Página `/approvals`

Nova rota + item no `AppSidebar` com badge de contagem pendente.

Layout (estilo inbox):
- Lista esquerda: cards com lead, canal, tipo, tempo aguardando, preview.
- Painel direito: detalhe do lead resumido, contexto da IA (rationale, intent, histórico recente), editor da mensagem (subject + body) ou dos parâmetros da ação, botões **Aprovar e enviar**, **Editar e enviar**, **Rejeitar** (com motivo opcional).
- Filtros: tipo (first_message/sdr_reply/cadence_step/sensitive_action), canal, cadência.

Realtime via Supabase channel para atualizar a fila ao vivo.

## 5. Execução pós-aprovação

Edge function `approval-execute`:
- Recebe `approval_request_id` + payload final.
- Marca `status=approved` (ou `edited_sent`) e chama o caminho de envio real (`send-outbound-message`, Cal.com, etc.) com o payload aprovado.
- Em rejeição: marca `status=rejected`, registra activity e — conforme `kind` — pausa enrollment ou apenas descarta a resposta.

## 6. UI extras

- Badge "🕓 Aguardando aprovação" no `LeadDetail` e no card de enrollment em `CadenceDetail`.
- Em `Conversations`, mensagens pending aparecem com estilo tracejado + tag "Pendente de aprovação".

## Detalhes técnicos

- Migração: 1 ALTER em `companies` + CREATE TABLE `approval_requests` + GRANTs + RLS (`has_role admin/company_admin` ou `get_user_company_id`).
- Hooks novos: `useApprovals`, `useApprovalMutations` (approve/edit/reject).
- Tipos AI SDK: nada novo; payloads são `jsonb`.
- Sem timeout/auto-aprovação — explicitamente fora de escopo.
- Indicadores de simulação atuais (dry-run da cadência agentic) permanecem; HITL é camada acima e prioritária: se HITL ligado, mesmo em modo "real" nada sai sem aprovação.

## Fora de escopo desta entrega

- Aprovação por email/WhatsApp (link mágico). Hoje só dentro do app.
- Auto-aprovação por timeout / regras condicionais (ex: "auto-aprovar se confiança > 0.9").
- Múltiplos revisores / workflow de 2 níveis.
