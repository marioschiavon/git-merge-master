

# Fix Upload de Arquivos na Base de Conhecimento

## Problema
O Supabase Storage rejeita nomes de arquivo com espaços e caracteres especiais (parênteses, acentos). O erro: `Invalid key: .../DOSSIE TÉCNICO GROOMER GENIUS (COM REFS).pdf`

## Solução
Sanitizar o nome do arquivo antes do upload em `src/hooks/useKnowledge.ts`, substituindo caracteres problemáticos por underscores.

### Arquivo: `src/hooks/useKnowledge.ts`
- Na função `useUploadKnowledgeDoc`, sanitizar `file.name` antes de montar o `filePath`
- Remover acentos, espaços, parênteses e outros caracteres especiais
- Manter apenas letras, números, hífens, underscores e pontos

```typescript
const safeName = file.name
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
  .replace(/[^a-zA-Z0-9._-]/g, "_"); // substitui caracteres especiais
const filePath = `${companyId}/${Date.now()}_${safeName}`;
```

Apenas 1 arquivo editado, ~2 linhas alteradas.

