## Situação atual

As anotações estão sendo **salvas** (em `approval-execute` quando o humano aprova/edita/rejeita, e em `annotate-decision` quando anota uma decisão do agente), mas **nunca são lidas** de volta por nenhuma função de IA. Ou seja: escrever anotação hoje serve só para auditoria/exportação — a IA continua gerando as próximas mensagens sem saber que você corrigiu algo.

## Objetivo

Fazer com que as anotações voltem como contexto de treino leve ("lições aprendidas") para a IA nas próximas decisões do mesmo lead e da mesma empresa.

## Escopo da mudança

### 1. Helper compartilhado
Criar `supabase/functions/_shared/annotations-context.ts` com uma função `fetchAnnotationsContext({ companyId, leadId, limit })` que:
- Busca as anotações mais recentes (padrão: últimas 10 do lead + últimas 5 da empresa).
- Retorna um bloco de texto pronto para injetar no system prompt no formato:
  ```
  ## Correções e observações do time (aprenda com elas)
  - [rejeitada] "não usar 'oportunidade única'; soa pushy"
  - [editada]   "encurtar CTA — o humano trocou por 'topa 15min?'"
  - [empresa]   "cliente prefere WhatsApp, ignora email"
  ```
- Prioriza `human_action ∈ {rejected, edited}` (correções explícitas) sobre `approved/none`.
- Limita ~1200 caracteres para não estourar o prompt.

### 2. Consumidores da IA que passam a injetar o bloco

Nos pontos onde o system prompt é montado, chamar o helper e prepender/apendar o bloco:
- `supabase/functions/cadence-agent-decide/index.ts` — decisão de próximo passo por lead.
- `supabase/functions/sdr-agent/index.ts` — respostas do agente autônomo.
- `supabase/functions/generate-reply/index.ts` — geração de respostas.
- `supabase/functions/ai-reply/index.ts` — replies via IA.
- `supabase/functions/human-suggest-reply/index.ts` — sugestão para inbox humana.
- `supabase/functions/cadence-executor/index.ts` — quando gera primeira mensagem custom.
- `supabase/functions/generate-pending-first-messages/index.ts` — mesma coisa para batch.

Cada função lê `companyId` e `leadId` (já disponíveis) e passa pro helper.

### 3. Aviso na UI
Na página **Anotações** (`src/pages/Annotations.tsx`) trocar o subtítulo por algo como:
> "A IA lê as anotações mais recentes deste lead/empresa antes de gerar próximas mensagens — use para corrigir tom, ganchos e o que evitar."

Assim o usuário sabe que anotar tem efeito real.

### 4. Sem mudança de schema
A tabela `message_annotations` já tem tudo que precisamos (`note`, `human_action`, `lead_id`, `company_id`, `created_at`). Nenhuma migration necessária.

## Verificação

1. Rodar `cadence-agent-decide` num lead com anotação recente do tipo "não citar preço na primeira mensagem" e conferir no log do run que o bloco de correções foi injetado no prompt.
2. Verificar `sdr_agent_runs.input_snapshot` do próximo run — deve conter o bloco.
3. UI: subtítulo da página Anotações atualizado.

## Detalhes técnicos

- Query: `select note, human_action, source_kind, lead_id, created_at from message_annotations where company_id = $1 and (lead_id = $2 or lead_id is null) order by (human_action in ('rejected','edited')) desc, created_at desc limit 15`.
- Truncar cada nota a 220 chars; bloco total a ~1200 chars.
- Se não houver anotações, o helper retorna string vazia e nada é injetado.