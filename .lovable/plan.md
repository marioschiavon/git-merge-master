

# Adicionar Edição de Scripts

## O que será feito

### 1. Hook `useUpdateScript` em `src/hooks/useScripts.ts`
- Nova mutation que faz `update` na tabela `script_templates` por `id`
- Permite alterar: `name`, `segment`, `channel`, `tone`, `base_script`

### 2. Botão "Editar" nos cards de script em `src/pages/Scripts.tsx`
- Ícone de edição (Pencil) ao lado dos botões existentes
- Ao clicar, abre o mesmo dialog de criação manual, porém pré-preenchido com os dados do script
- Botão muda para "Salvar Alterações" e chama `useUpdateScript` em vez de `useCreateScript`
- Reutiliza os mesmos states do dialog manual (`manualOpen`, `manualName`, etc.) + um `editingScriptId` para distinguir criação de edição

### Arquivos modificados
- `src/hooks/useScripts.ts` — adicionar `useUpdateScript`
- `src/pages/Scripts.tsx` — botão Editar + lógica de pré-preenchimento do dialog

Sem alterações de banco (RLS já permite UPDATE via policy ALL).

