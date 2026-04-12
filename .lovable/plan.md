

## Exibir Variações Salvas no Card de Cada Script

### Problema
As variações são salvas corretamente na tabela `script_variations`, mas a página `/scripts` não exibe as variações salvas em nenhum lugar. O hook `useScriptVariations` existe mas não é usado na listagem.

### Solução
Adicionar uma seção expansível (accordion/collapsible) em cada card de script mostrando as variações salvas, com contagem visível.

### Detalhes técnicos

**Arquivo: `src/pages/Scripts.tsx`**

1. Importar `useScriptVariations` (ou criar uma query que busca todas as variações da empresa de uma vez)
2. Criar um sub-componente `ScriptCard` que recebe o script e internamente usa `useScriptVariations(script.id)` para buscar as variações daquele template
3. No card, abaixo dos botões de ação, adicionar:
   - Badge com contagem de variações (ex: "3 variações")
   - Collapsible que ao expandir mostra cada variação com tom e texto
   - Botão para copiar cada variação individualmente
   - Botão para excluir variação individual

4. Adicionar hook `useDeleteVariation` em `useScripts.ts` para permitir excluir variações individuais

### Escopo
- 1 hook adicionado (`useDeleteVariation`)
- 1 página atualizada (extrair `ScriptCard` com variações visíveis)

