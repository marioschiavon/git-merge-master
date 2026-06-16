# Anotações do SDR para treino e correção

## Objetivo
Permitir que o humano escreva uma observação livre em itens de `/approvals` e em decisões do agente. Apenas itens **com anotação** ficam catalogados — junto de um snapshot do contexto — para depois consultar, treinar e corrigir o sistema em `/annotations`.

## Como vai funcionar (visão do usuário)

1. **Em `/approvals`** — cada card de aprovação ganha um campo "Anotação (opcional)". Se preenchido ao Aprovar / Editar+Aprovar / Rejeitar, a nota é salva junto com um snapshot do que a IA tinha em mãos.
2. **Em decisões do agente** (drawer do lead em cadências, onde aparece o raciocínio) — botão "Anotar" abre textarea. Salva mesmo sem aprovação envolvida.
3. **Nova página `/annotations`** — lista cronológica filtrável por lead, autor, fonte (aprovação vs decisão), data; busca por texto; ver detalhe completo (mensagem + contexto + nota); exportar CSV/JSON para usar em ajustes de prompt, knowledge base ou fine-tuning futuro.

## O que é salvo (snapshot do contexto)

Para cada anotação, persistimos um pacote autocontido — assim a nota continua útil mesmo se o lead/conversa mudar depois:

- **Nota**: texto livre, autor (`user_id`), `created_at`
- **Fonte**: `approval_request` ou `cadence_agent_decision` (+ id)
- **Ação tomada pelo humano** (quando vier de aprovação): approved / edited / rejected, conteúdo final enviado, edits aplicados vs proposta original
- **Snapshot da proposta da IA**: canal, subject, body, hook, rationale, intent, confidence
- **Snapshot do lead**: nome, empresa, email, estágio, metadata relevante
- **Snapshot da conversa**: últimas N mensagens (in/out) no momento da anotação
- **Snapshot do contexto agente**: cadence_id/step, knowledge chunks usados (ids + similaridade), prompt resumido se disponível

Tudo em uma coluna `jsonb context_snapshot` para ficar flexível sem migração nova a cada ajuste.

## Detalhes técnicos

### Nova tabela `public.message_annotations`
- `id uuid pk`
- `company_id uuid` (multi-tenant)
- `author_user_id uuid`
- `source_kind text` check in (`approval_request`, `cadence_agent_decision`)
- `source_id uuid` (id do approval ou da decisão)
- `lead_id uuid` nullable
- `conversation_id uuid` nullable
- `note text not null` (>= 1 char — sem nota, nada é salvo)
- `human_action text` nullable (`approved` | `edited` | `rejected` | `none`)
- `final_content text` nullable (o que foi efetivamente enviado, quando aplicável)
- `context_snapshot jsonb not null default '{}'`
- `tags text[]` reservado para uso futuro (categorização vem depois conforme padrões emergirem)
- `created_at`, `updated_at`

GRANTs para `authenticated` e `service_role`. RLS por `company_id` via `get_user_company_id(auth.uid())`. Índices em `(company_id, created_at desc)`, `lead_id`, `source_kind, source_id`.

### Backend
- **`approval-execute`**: aceita `note?: string` no body. Se presente, monta o snapshot (lê approval_request + lead + últimas mensagens da conversa + decisão agente referenciada) e insere em `message_annotations` antes/depois da execução, registrando `human_action` e `final_content`.
- **Nova edge `annotate-decision`**: para anotar uma `cadence_agent_decisions` sem aprovação. Body `{ decision_id, note }`. Monta snapshot equivalente (decisão + lead + conversa + knowledge usado) e insere. Validação Zod, CORS, JWT em código.
- **Hook `useAnnotations`**: list (com filtros), get-by-id, create (para o caso de decisão).

### Frontend
- **`/approvals` (Approvals.tsx)**: textarea "Anotação" em cada card; passa `note` ao chamar `approval-execute`. Toast confirma "Anotação salva" quando preenchida.
- **Drawer/timeline do agente** (`LeadProgressDrawer` ou `LeadTimeline`): botão "Anotar" nas decisões → dialog com textarea → chama `annotate-decision`.
- **Nova `/annotations`** (`src/pages/Annotations.tsx`):
  - Lista: data, autor, lead, fonte, trecho da nota, ação humana
  - Filtros: período, autor, fonte, lead, busca texto
  - Detalhe (drawer ou rota `/annotations/:id`): nota + proposta IA + edits + final enviado + histórico de mensagens + knowledge usado
  - Botão "Exportar" → CSV e JSON
- **Sidebar**: novo item "Anotações" (visível para `company_admin` e `user`). Rota em `App.tsx`.

### Fora de escopo (deixar para depois)
- Categorização estruturada / taxonomia automática (texto livre primeiro, padrões viram tags depois)
- Treinamento automático / re-injeção das notas no prompt do agente
- Anotar mensagens já enviadas em `/conversations` (foco agora é o loop de aprovação)
- Permissões finas (qualquer membro da empresa pode anotar e ler anotações da própria empresa)

## Arquivos afetados
- **Migração**: cria `message_annotations` com GRANTs + RLS + índices
- **Edge**: `approval-execute/index.ts` (estende com `note`), nova `annotate-decision/index.ts`
- **Frontend novo**: `src/pages/Annotations.tsx`, `src/hooks/useAnnotations.ts`
- **Frontend editado**: `src/pages/Approvals.tsx`, `src/components/cadence/LeadProgressDrawer.tsx` (ou `LeadTimeline.tsx`), `src/components/AppSidebar.tsx`, `src/App.tsx`
