

## Personalizar Mensagens da Cadência com Lead Insights

### Problema
O `cadence-executor` gera mensagens usando apenas nome, email, empresa e knowledge base da empresa vendedora. Os insights do prospect (obtidos pelo scraping) não são incluídos no contexto da IA, resultando em mensagens genéricas.

### Solução

**Alterar `supabase/functions/cadence-executor/index.ts`:**

1. **Buscar `lead_insights`** antes de gerar a mensagem — query na tabela `lead_insights` filtrando por `lead_id`
2. **Incluir insights no prompt da IA** — adicionar uma seção "INSIGHTS DO PROSPECT" no system prompt com: proposta de valor, produtos, diferenciais, pain points e sugestões de abordagem
3. **Atualizar as regras do prompt** — instruir a IA a usar os insights para personalizar a abordagem (ex: mencionar um produto específico do prospect, referenciar um diferencial, conectar a dor do prospect com a solução)

O bloco adicionado ao prompt ficaria algo como:

```text
INSIGHTS DO PROSPECT (obtidos do website do lead):
- Proposta de valor: ...
- Produtos/Serviços: ...
- Diferenciais: ...
- Pain points: ...
- Sugestões de abordagem: ...

Use esses insights para personalizar a mensagem. Mencione algo específico do negócio do prospect.
```

### Escopo
- 1 arquivo alterado: `supabase/functions/cadence-executor/index.ts`
- Redeploy da edge function

### Resultado
Quando o lead tem insights salvos (via "Analisar Website"), as mensagens geradas pela cadência serão altamente personalizadas, mencionando detalhes reais do negócio do prospect.

