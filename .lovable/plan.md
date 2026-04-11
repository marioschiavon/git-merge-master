

## Email de Prospecção: Mais Curto, Objetivo e com Hook dos Insights

### Problema
O prompt atual instrui emails com até 150 palavras e regras genéricas. O resultado são emails longos e sem gancho claro baseado nos insights do prospect.

### Solução

Alterar o bloco de regras do prompt no `cadence-executor` para emails:

1. **Reduzir limite de palavras** — de 150 para **80 palavras** máximo
2. **Estrutura obrigatória do email** com hook baseado no insight:
   - **Linha 1 (HOOK)**: Frase curta mencionando algo específico do prospect (insight do website) — ex: "Vi que a [empresa] está focada em [X]..."
   - **Linha 2-3 (CONEXÃO)**: Conectar o hook com o benefício do seu produto em 1-2 frases diretas
   - **Linha 4 (CTA)**: Pergunta direta para agendar — ex: "Faz sentido conversarmos 15min essa semana?"
3. **Subject curto e intrigante** — máximo 6 palavras, referenciando o insight do prospect
4. **Proibir** introduções genéricas ("Meu nome é...", "Somos uma empresa que...")

### Trecho do prompt atualizado

```text
Email: MÁXIMO 80 palavras. Estrutura obrigatória:
1. HOOK (1 frase): Mencione algo específico do prospect (do insight) que chame atenção
2. CONEXÃO (1-2 frases): Ligue o hook a 1 benefício concreto do seu produto
3. CTA (1 frase): Pergunta direta para agendar reunião de 15min
- Subject: máximo 6 palavras, curioso, referenciando o negócio do prospect
- PROIBIDO: "Meu nome é...", "Somos uma empresa...", introduções longas
- Tom: direto, confiante, como se já conhecesse o mercado do prospect
```

### Escopo
- 1 arquivo: `supabase/functions/cadence-executor/index.ts` (apenas bloco de regras do email)
- Redeploy da edge function

### Resultado
Emails curtos, com hook personalizado baseado nos insights do website do prospect, gerando mais curiosidade e taxa de resposta.

