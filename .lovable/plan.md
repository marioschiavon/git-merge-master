## Problema

No Run do SDR, o lead perguntou sobre as **vantagens para a clínica dele**. O agente tentou `search_knowledge` várias vezes com termos diferentes, não encontrou chunks compatíveis e foi direto para `escalate_to_human`. Isso quebra a conversa por um motivo evitável: a base tem informação útil (highlights, instruções de abordagem, value_proposition, documentos), só não está indexada com aquele vocabulário específico ("vantagens para clínica odontológica X").

A causa raiz é dupla:

1. **`search_knowledge` é o ÚNICO acesso à KB** e depende 100% de similaridade vetorial em `knowledge_chunks`. Se o embedding não casar, o agente "acha" que a empresa não tem resposta.
2. **Highlights, AI instructions e value_proposition já existem no banco** (são usados em `generate-reply`), mas **não são injetados no contexto do `sdr-agent`** — então a IA não sabe que existem.
3. O prompt orienta a escalar quando "faltar informação crítica", sem exigir esgotar a KB antes (listar títulos, reformular busca, combinar com a proposta de valor da empresa).

## Solução proposta

Tornar o `sdr-agent` autossuficiente para responder dúvidas como "quais as vantagens pra mim", usando todo o conhecimento que a empresa já cadastrou.

### 1. Carregar KB curada direto no contexto (sempre disponível, sem tool call)
Em `loadContext`, além do que já busca, ler de `company_knowledge`:
- `highlights` (diferenciais para prospecção)
- `ai_instructions` (instruções de abordagem)
- Lista de **títulos** de todos os documentos da KB (até ~30) — para o agente saber o que existe e fazer buscas direcionadas.

Incluir no system prompt um bloco:
```
## Base de conhecimento da empresa
Diferenciais (highlights): ...
Instruções de abordagem: ...
Documentos disponíveis na KB (use search_knowledge para abrir):
- "Cases de clínicas odontológicas"
- "ROI por segmento"
- ...
```

### 2. Nova tool `list_knowledge`
Retorna todos os títulos + tipo + um snippet curto (primeiros 300 chars) dos itens da `company_knowledge`. Útil quando `search_knowledge` retorna pouco — o agente vê o catálogo e escolhe um item para ler na íntegra.

### 3. Nova tool `read_knowledge_item`
Recebe um `knowledge_id` (ou título) e devolve o conteúdo completo daquele item. Permite à IA ler um documento inteiro quando a busca semântica falhar.

### 4. Endurecer o prompt anti-escalação prematura
Adicionar regra explícita:
> Antes de escalar para humano por "falta de informação", você DEVE:
> 1. Tentar `search_knowledge` com pelo menos 2 reformulações diferentes.
> 2. Chamar `list_knowledge` para ver o catálogo.
> 3. Ler com `read_knowledge_item` qualquer documento que tenha título relacionado.
> 4. Se mesmo assim faltar dado factual específico (número, prazo, integração), responda combinando os **diferenciais** e a **proposta de valor** da empresa de forma consultiva (sem inventar números) e proponha a reunião para detalhar — em vez de escalar.
> Só escale quando for objeção complexa, reclamação, jurídico ou pedido fora do escopo comercial.

### 5. Permitir resposta consultiva mesmo com KB parcial
Instrução adicional: se a pergunta é "quais as vantagens pra mim/meu negócio", a resposta correta é **personalizar a proposta de valor + diferenciais** ao contexto do lead (segmento, empresa, dor mencionada no histórico) e **convidar para a reunião** para aprofundar. Isso NÃO é alucinação — é vendas consultiva legítima sobre informação que a empresa já curou.

## Detalhes técnicos

Arquivo único alterado: `supabase/functions/sdr-agent/index.ts`.

- `loadContext`: adicionar três queries em paralelo
  - `company_knowledge` onde `type='highlights'`
  - `company_knowledge` onde `type='ai_instructions'`
  - `company_knowledge` (demais tipos) — `id, title, type, content` limit 30
- `buildSystemPrompt`: novo bloco `## Base de conhecimento da empresa` com highlights, ai_instructions, e lista de títulos+ids dos documentos.
- `TOOLS`: adicionar `list_knowledge` (sem args, retorna catálogo) e `read_knowledge_item` (arg: `knowledge_id` string).
- `execTool`: implementar os dois novos handlers usando `supabase.from("company_knowledge")`.
- Regras no system prompt: adicionar a seção "Antes de escalar..." e a regra de resposta consultiva para perguntas tipo "vantagens".

Nada disso muda o modo shadow/live nem o resto do pipeline — é só dar mais contexto e ferramentas ao agente. Próximo Run do SDR já deve mostrar a diferença: em vez de escalar, ele lista a KB, lê o doc relevante e propõe resposta + reunião.
