

## Customização Inteligente por Step — Switch On/Off

### O que será feito
Adicionar um switch "Customização Inteligente" em cada step card. Quando ligado, o executor usará os diferenciais e insights da análise do site do prospect para personalizar a mensagem. Quando desligado, a IA gera a mensagem baseada apenas no template, sem usar insights do prospect.

### Observação importante
O executor **já busca** os insights do lead (`lead_insights`) e os usa no prompt da IA (linhas 80-99 do executor). O que falta é um **controle por step** para ativar/desativar esse comportamento.

### Detalhes técnicos

**1. Migração — nova coluna `smart_customization`**
- Adicionar `smart_customization boolean NOT NULL DEFAULT true` na tabela `cadence_steps`
- Default `true` para que steps existentes já usem a customização

**2. UI — `src/components/CadenceStepCard.tsx`**
- Adicionar um Switch com label "Customização Inteligente" e ícone de Sparkles abaixo do template
- Tooltip explicando: "Usa os diferenciais do site do prospect para personalizar a mensagem"
- Quando alterado, chama `onUpsert({ ...step, smart_customization: value })`

**3. Executor — `supabase/functions/cadence-executor/index.ts`**
- Condicionar a busca e inclusão de `insightsContext` ao valor de `currentStep.smart_customization`
- Se `smart_customization === false`, setar `insightsContext = ""` e ajustar o prompt para não mencionar insights
- Se `true` (ou não definido, para retrocompatibilidade), manter o comportamento atual

### Escopo
- 1 migração (nova coluna)
- 1 componente UI atualizado (switch no card)
- 1 edge function atualizada (condicional no executor)

