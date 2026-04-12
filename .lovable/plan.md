

## Adicionar Switch "Usar Destaques" no Step da Cadência

### O que será feito
Adicionar um segundo Switch abaixo do "Customização Inteligente" chamado **"Usar Destaques da Empresa"** que controla se os Destaques para Prospecção (highlights) devem ser incluídos no contexto da IA ao gerar mensagens.

### Detalhes técnicos

**1. Migração — nova coluna `use_highlights` em `cadence_steps`**
- `ALTER TABLE cadence_steps ADD COLUMN use_highlights boolean NOT NULL DEFAULT true`

**2. UI — `CadenceStepCard.tsx`**
- Adicionar Switch "Usar Destaques da Empresa" logo abaixo do Switch de Customização Inteligente
- Tooltip: "Inclui os destaques da empresa (patentes, matérias, etc.) como argumentos de autoridade na mensagem"
- Só aparece visível quando `smart_customization` está ativado
- Persiste via `onUpsert({ ...step, use_highlights: v })`

**3. Edge Functions — `cadence-executor` e `preview-cadence-messages`**
- Verificar `step.use_highlights !== false` antes de injetar o `highlightsContext` no prompt
- Se `use_highlights` for `false`, omitir a seção de destaques do prompt da IA

### Escopo
- 1 migração (nova coluna)
- 1 componente atualizado (novo Switch)
- 2 edge functions atualizadas (condicional no highlights)

