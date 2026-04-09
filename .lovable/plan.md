

# Integrar Scripts com Cadências + Criar Scripts Manuais

## O que será feito

### 1. Botão "Criar Script Manual" na página Scripts
- Adicionar botão "Novo Script" ao lado do "Gerar com IA"
- Dialog com formulário manual: nome, segmento, canal, tom e texto do script
- Salva com `is_ai_generated: false`

### 2. Botão "Usar em Cadência" nos cards de script
- Cada card de script ganha um botão "Usar em Cadência"
- Ao clicar, abre um seletor com as cadências existentes
- Usuário escolhe a cadência e o step recebe o script como template

### 3. Botão "Preencher com IA" nos steps da Cadência (CadenceDetail)
- No template de cada step, adicionar botão com ícone de IA
- Ao clicar, abre um dialog com duas opções:
  - **Escolher da biblioteca** — lista scripts salvos filtrados pelo canal do step
  - **Gerar na hora** — mini-wizard inline (segmento + tom) que chama a edge function
- O texto selecionado/gerado preenche o campo template do step

### Arquivos modificados
- `src/pages/Scripts.tsx` — dialog de criação manual + botão "Usar em Cadência"
- `src/components/CadenceDetail.tsx` — botão "Preencher com IA" / "Escolher Script" em cada step
- `src/hooks/useScripts.ts` — sem alterações (já tem `useCreateScript` e `useGenerateScript`)
- `src/hooks/useCadences.ts` — sem alterações (já tem `useUpsertStep`)

Sem alterações de banco de dados necessárias.

