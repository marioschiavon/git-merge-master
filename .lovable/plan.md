## Simplificação da Cadência Inteligente

Remover do formulário tudo que é redundante com configuração global ou já automático no sistema.

## Mudanças

### 1. `AgenticPolicyForm.tsx` — manter só o essencial
Campos que permanecem:
- **Objetivo**
- **Máx. tentativas**
- **Prazo (dias)**
- **Canais permitidos**
- **Canal principal**

Campos removidos da UI:
- ~~Tom / instruções da IA~~ → usar `ai_instructions` global (Knowledge)
- ~~Critérios para continuar~~
- ~~Critérios para parar (6 checkboxes + texto livre)~~ → tudo automático
- ~~Fit score mínimo~~

Atualizar `defaultPolicy` removendo `tone_instructions`, `continue_criteria`, `stop_criteria_flags`, `stop_criteria_text`, `min_fit_score`.

Atualizar o aviso do topo para refletir que tom vem de Knowledge.

### 2. `cadence-agent-decide` — paradas automáticas sempre ligadas
Hoje o código lê `policy.stop_criteria_flags` para decidir se aplica cada parada. Trocar para:
- `meeting_booked`, `opt_out` (intent `compliance`), `no_interest` (intent `rejection`), `max_attempts`, `max_days` → **sempre aplicados** (sem checar flags).
- Ignorar `min_fit_score` (bloco removido).
- Ignorar `continue_criteria` / `stop_criteria_text` no prompt.
- No `systemPrompt` da decisão agêntica, remover as linhas de `tone`, `continue_criteria` e `stop_criteria_text`. Em vez de `policy.tone_instructions`, passar o conteúdo de `company_knowledge` tipo `ai_instructions` como tom (já é carregado).
- No `buildFirstMessage`, parar de passar `tone` — ele já lê `ai_instructions` da empresa internamente.

### 3. `cadence-agent-decide` chamada do helper
Remover `tone: policy.tone_instructions` do call do `buildFirstMessage`. O helper continua puxando `ai_instructions` global.

### 4. Banco — manter colunas, parar de usar
Não vou dropar colunas em `cadence_policies` (`tone_instructions`, `continue_criteria`, `stop_criteria_flags`, `stop_criteria_text`, `min_fit_score`) — políticas antigas continuam válidas mas os campos serão ignorados pelo runtime. Zero risco de migration.

Se preferir limpar o schema, dropo numa migration separada — me avise.

### 5. `useAgenticCadence.ts` — manter tipo
O type `CadencePolicy` mantém os campos opcionais por compat; novos forms não escrevem mais neles.

## Validação

1. Abrir uma cadência inteligente: form mostra só Objetivo / Máx tentativas / Prazo / Canais / Canal principal.
2. Criar nova cadência inteligente, enrolar lead → 1ª mensagem usa `ai_instructions` da empresa como tom (sem campo na cadência).
3. Lead recebe intent `rejection` → cadência para automaticamente (sem depender de flag).
4. Reunião agendada (Cal.com) → cadência para automaticamente.
5. Atinge max_attempts → para automaticamente.

## Fora de escopo

- Dropar colunas do banco (fica como cleanup opcional posterior).
- Migrar políticas antigas (não há nada para migrar — campos só param de ser lidos).
