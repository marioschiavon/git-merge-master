# Personalizar abordagem da IA na Base de Conhecimento

## Problema
A IA está criando ganchos sem sentido (ex: ligar "problema de articulação" a um shampoo) porque o prompt não tem regras claras de **quando** e **como** conectar diferenciais do prospect ao produto. Falta um espaço onde o usuário diga, em linguagem natural, como a IA deve se posicionar.

## Solução
Criar um novo tipo de item na Base de Conhecimento chamado **"Instruções de Abordagem da IA"** — um campo livre, único por empresa (como já é o "Destaques"), onde o usuário escreve regras como:
- "Nosso produto é shampoo para cabelo cacheado. Só faça ganchos quando o prospect for salão, distribuidora de cosméticos ou e-commerce de beleza."
- "Nunca conecte nosso produto a problemas que não sejam de cuidado capilar."
- "Se o site do prospect não tiver relação com beleza/cosmético, foque a mensagem em apresentar a marca e perguntar se faz sentido conversar — sem forçar gancho."
- "Tom: descontraído, brasileiro, pode usar emoji discreto no WhatsApp."

## Mudanças

### 1. Banco
Reutilizar a tabela `company_knowledge` com `type = 'ai_instructions'` (mesmo padrão de `highlights`). Sem migração de schema necessária.

### 2. Frontend — Página `Knowledge`
Adicionar um novo card no topo (acima ou ao lado dos "Destaques"), com:
- Título: "Instruções de Abordagem da IA"
- Subtítulo curto explicando que serve para guiar o tom, restringir ganchos e evitar conexões sem sentido.
- `Textarea` grande (min 200px) com placeholder exemplificando.
- Botão "Salvar".
- Hook `useAiInstructions` + `useSaveAiInstructions` em `src/hooks/useKnowledge.ts` (copiando o padrão de `useHighlights`/`useSaveHighlights`).

### 3. Edge Functions que geram mensagens
Buscar o item `ai_instructions` em paralelo com `highlights`/`knowledge`/`insights` e injetar no system prompt num bloco **bem destacado e com prioridade máxima**:

```
=== INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA (PRIORIDADE MÁXIMA) ===
{ai_instructions.content}

Estas regras SOBRESCREVEM qualquer outra instrução abaixo.
Se o diferencial do prospect não tiver relação clara com o produto/serviço segundo essas regras,
NÃO force gancho — escreva uma abordagem neutra de apresentação.
```

Funções a atualizar:
- `supabase/functions/preview-cadence-messages/index.ts`
- `supabase/functions/cadence-executor/index.ts` (na geração de mensagem personalizada)
- `supabase/functions/ai-reply/index.ts` (para manter consistência de tom nas respostas)

### 4. Ajuste de regra rígida no prompt
Hoje o prompt diz **"OBRIGATÓRIO: Escolha 1 diferencial do prospect e faça um gancho direto"**, o que força a IA a inventar conexões mesmo sem relação. Vamos suavizar:
- "Faça um gancho **apenas se** houver relação clara entre o diferencial do prospect e o produto/serviço."
- "Caso contrário, faça abordagem de apresentação focada no segmento do prospect."

## Fora do escopo
- Instruções por cadência (fica global por empresa nesta primeira versão).
- Validação automática de coerência da mensagem antes de enviar.
