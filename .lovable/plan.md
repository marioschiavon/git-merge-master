# Plano: Filtro por Step no Dashboard de Cadências

## Objetivo
Adicionar um filtro por etapa (step) da cadência na tela `/cadences/dashboard`, permitindo que o usuário visualize leads que estão em uma etapa específica da sequência.

## Mudanças

### 1. Estado do filtro
- Adicionar `stepFilter` (string, default `"all"`) ao componente `CadencesDashboard`.

### 2. UI — Select de Steps
- Inserir um novo `<Select>` ao lado dos filtros existentes (busca, status, intent).
- As opções do select serão dinâmicas, baseadas nos `steps` da cadência selecionada (já carregados via `useCadenceSteps`).
- Cada opção mostrará: "Step N — Canal" (ex: "Step 2 — email").
- Opção padrão: "Todos steps".

### 3. Lógica de filtro
- Aplicar `stepFilter` no `useMemo` de `filtered`:
  - Se `stepFilter !== "all"`, comparar `String(enrollment.current_step) !== stepFilter`.
- O `current_step` já está disponível em cada row retornado por `useCadenceLeadProgress`.

### 4. Estatísticas (KPIs)
- Os KPIs permanecem calculados sobre o total da cadência (não afetados pelo filtro de step).

## Arquivos alterados
- `src/pages/CadencesDashboard.tsx`

## Fora do escopo
- Mudanças no drawer de lead.
- Novos hooks ou queries ao backend.