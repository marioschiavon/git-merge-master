

## Cruzar Knowledge Base do Produto com Insights do Prospect

### Problema
Atualmente o prompt do `cadence-executor` tem duas seções separadas: "CONTEXTO DA EMPRESA" (knowledge base do produto que você vende) e "INSIGHTS DO PROSPECT" (dados do website do lead). A IA não recebe instrução explícita para **cruzar** as duas — conectar uma dor específica do prospect com uma funcionalidade específica do seu produto.

### Solução

Alterar o prompt no `cadence-executor` para incluir uma instrução clara de **cross-referencing**:

1. **Renomear e reorganizar as seções** do prompt para deixar claro o papel de cada uma
2. **Adicionar uma instrução de cruzamento** que diga à IA para:
   - Identificar qual produto/funcionalidade da knowledge base resolve qual pain point do prospect
   - Usar um diferencial do prospect como gancho para conectar com a solução
   - Nunca enviar mensagem genérica quando tem insights disponíveis
3. **Melhorar o bloco de regras** com instruções como:
   - "Conecte pelo menos 1 pain point do prospect com 1 benefício específico do seu produto"
   - "Use o contexto do mercado do prospect para justificar por que seu produto é relevante para ele"

### Exemplo do prompt atualizado

```text
REGRAS DE PERSONALIZAÇÃO:
- OBRIGATÓRIO: Conecte pelo menos 1 pain point do prospect com 1 benefício do seu produto
- Mencione algo específico do negócio do prospect (produto, mercado, diferencial)
- Mostre como seu produto resolve uma dor real que o prospect provavelmente tem
- Nunca seja genérico — cada mensagem deve parecer escrita à mão para aquele prospect
```

### Escopo
- 1 arquivo alterado: `supabase/functions/cadence-executor/index.ts` (apenas o bloco de prompt)
- Redeploy da edge function

### Resultado
As mensagens geradas vão conectar diretamente "o que você vende" com "o que o prospect precisa", resultando em abordagens muito mais assertivas e com maior taxa de resposta.

