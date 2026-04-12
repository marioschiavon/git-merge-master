

## Corrigir: Dialog de Variações não permite scroll

### Problema
Ao gerar 3 variações, o conteúdo do dialog cresce além da tela e não há scroll, tornando impossível ver/salvar as variações.

### Solução

**Arquivo: `src/pages/Scripts.tsx` — Dialog de Variações (linha 365)**

- Adicionar `max-h-[80vh] overflow-y-auto` ao `<div className="space-y-4">` dentro do DialogContent (linha 369)
- Adicionar `max-h-40` com `overflow-y-auto` no `<pre>` de cada variação (linha 380) para limitar textos longos

### Escopo
- 1 arquivo, 2 linhas alteradas

