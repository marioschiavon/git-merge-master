

## Adicionar Campo "Destaques para Prospecção" na Base de Conhecimento

### O que será feito
Adicionar uma nova coluna `highlights` (texto) na tabela `company_knowledge` e um campo editável na UI da Base de Conhecimento para o SDR cadastrar informações-chave que a IA deve usar como argumentos de autoridade nos emails (ex: links de matérias, origem americana, patentes, prêmios).

Esses destaques serão injetados com prioridade no prompt da IA nas cadências.

### Detalhes técnicos

**1. Migração — nova coluna `highlights` em `company_knowledge`**
- `ALTER TABLE company_knowledge ADD COLUMN highlights text DEFAULT NULL`
- Campo opcional, sem quebrar dados existentes

**2. UI — `src/pages/Knowledge.tsx`**
- Adicionar um card fixo no topo da página (fora das tabs) chamado "Destaques para Prospecção"
- Textarea com placeholder: "Ex: Empresa de origem americana, possuidora de patente mundial, matéria no Jornal X (link)..."
- Botão Salvar que faz upsert de um item `company_knowledge` com `type = 'highlights'`
- Se já existir um item com `type = 'highlights'`, carrega e permite edição
- Apenas 1 item de highlights por empresa

**3. Hook — `src/hooks/useKnowledge.ts`**
- Adicionar `useHighlights()` para buscar item com `type = 'highlights'`
- Adicionar `useSaveHighlights()` para upsert

**4. Edge Functions — Executor e Preview**
- Em `cadence-executor/index.ts` e `preview-cadence-messages/index.ts`: buscar o item de highlights junto com o knowledge
- Injetar no prompt como seção prioritária:
  ```
  DESTAQUES IMPORTANTES DA EMPRESA (use como argumentos de autoridade):
  {highlights content}
  ```
- Instrução no prompt: "OBRIGATÓRIO: Mencione pelo menos 1 destaque da empresa como argumento de credibilidade"

### Escopo
- 1 migração (nova coluna ou abordagem com type filter)
- 1 página atualizada (card de destaques no topo)
- 1 hook atualizado (busca/salva highlights)
- 2 edge functions atualizadas (injetar highlights no prompt)

### Resultado
O SDR cadastra informações de alto impacto (patentes, matérias, origens) uma vez, e a IA automaticamente usa esses argumentos de autoridade em todas as mensagens de prospecção.

