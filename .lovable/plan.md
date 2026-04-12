

## Adicionar Switch "Gatilhos Mentais" com Seleção por Step

### O que será feito
Adicionar um terceiro Switch abaixo de "Usar Destaques da Empresa" chamado **"Gatilhos Mentais"**. Quando ativado, exibe uma lista de checkboxes com os principais gatilhos mentais de vendas (escassez, urgência, prova social, autoridade, reciprocidade, etc.). Os selecionados são salvos por step e injetados no prompt da IA.

### Gatilhos mentais disponíveis
- **Escassez** — "Vagas limitadas", "últimas unidades"
- **Urgência** — "Só até sexta", "oferta expira"
- **Prova Social** — "Mais de X empresas já usam"
- **Autoridade** — "Recomendado por especialistas"
- **Reciprocidade** — Oferecer algo antes de pedir (material gratuito, diagnóstico)
- **Compromisso** — Pequeno sim antes do grande (micro-compromisso)
- **Novidade** — "Acabamos de lançar", "novo recurso"
- **Exclusividade** — "Acesso antecipado", "convite especial"

### Detalhes técnicos

**1. Migração — novas colunas em `cadence_steps`**
- `use_mental_triggers boolean NOT NULL DEFAULT false`
- `mental_triggers text[] DEFAULT '{}'` (array de strings com os gatilhos selecionados)

**2. UI — `CadenceStepCard.tsx`**
- Novo Switch "Gatilhos Mentais" (com ícone Brain/Zap) visível quando `smart_customization` está ativo
- Quando ligado, exibe grid de checkboxes com os gatilhos acima
- Persiste via `onUpsert({ ...step, use_mental_triggers: v, mental_triggers: [...] })`

**3. Edge Functions — `cadence-executor` e `preview-cadence-messages`**
- Se `step.use_mental_triggers === true` e `step.mental_triggers.length > 0`:
  - Injetar no prompt: `GATILHOS MENTAIS OBRIGATÓRIOS: Use os seguintes gatilhos na mensagem: ${triggers.join(", ")}`
- Se desligado, omitir do prompt

### Escopo
- 1 migração (2 colunas)
- 1 componente atualizado (switch + checkboxes)
- 2 edge functions atualizadas (condicional no prompt)

