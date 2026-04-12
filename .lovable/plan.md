

## Focar Customização Inteligente nos Diferenciais + Gancho com Produto

### Problema
Atualmente, a Customização Inteligente usa todos os insights do prospect (proposta de valor, produtos, pain points, público-alvo, etc.). O usuário quer que use **apenas os Diferenciais** do prospect, e que o prompt **sempre faça um gancho** entre um diferencial do prospect e a solução/produto do SDR (da base de conhecimento).

### Solução

Alterar os dois edge functions que montam o `insightsContext` e o prompt da IA:

**1. `supabase/functions/cadence-executor/index.ts`**
- No bloco de insights (linhas 89-101): extrair **apenas `ins.diferenciais`** em vez de todos os campos
- Reformular o `insightsContext` para focar em diferenciais:
  ```
  DIFERENCIAIS DO PROSPECT: ${ins.diferenciais.join(", ")}
  ```
- Atualizar as regras de personalização no prompt para:
  - OBRIGATÓRIO: Escolha 1 diferencial do prospect e faça um gancho direto com 1 benefício/produto da base de conhecimento
  - Estrutura: "Vi que vocês [diferencial do prospect] → nosso [produto/solução] potencializa isso porque [benefício concreto]"
  - Remover menções a pain points, proposta de valor, público-alvo do prompt

**2. `supabase/functions/preview-cadence-messages/index.ts`**
- Mesma alteração: extrair apenas diferenciais (linhas 60-72)
- Mesmo prompt atualizado (linhas 113-150)

### Escopo
- 2 edge functions atualizadas (executor e preview)
- Redeploy de ambas
- Nenhuma mudança de UI

### Resultado
A IA foca exclusivamente nos diferenciais do prospect, criando um gancho natural entre o que o prospect faz de melhor e como o produto do SDR complementa/potencializa isso.

