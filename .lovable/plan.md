
## Cadastro manual + Importação CSV de Leads

Hoje `/leads` só mostra leads vindos do Pipedrive. Vamos permitir criar leads manualmente e importar via CSV, mantendo a sincronização do Pipedrive funcionando.

### 1. UI em `src/pages/Leads.tsx`
Adicionar dois botões ao lado de "Sincronizar":
- **Novo Lead** → abre dialog com formulário
- **Importar CSV** → abre dialog de upload

Mostrar esses botões mesmo quando o Pipedrive não está conectado (substituindo o empty state atual por uma tela que já permite cadastrar).

### 2. Novo componente `src/components/LeadFormDialog.tsx`
Dialog com formulário (react-hook-form + zod) com campos:
- Nome* (obrigatório)
- Email, Telefone, Empresa, Cargo, Website, Endereço
- Status (select com os 5 status existentes, default `new`)
- Origem (texto livre, default `manual`)

Validação zod (trim, max lengths, email válido). Ao salvar: `insert` em `leads` com `company_id` do usuário atual e `source = 'manual'` (sem `pipedrive_id`).

### 3. Novo componente `src/components/LeadImportDialog.tsx`
- Input de arquivo `.csv`
- Parse com **papaparse** (precisa adicionar dependência)
- Mostra preview das primeiras 5 linhas + mapeamento de colunas detectado automaticamente (name, email, phone, company_name, title, website, address)
- Botão "Importar N leads" faz `insert` em lote (`supabase.from('leads').insert([...])`) com `source = 'csv_import'`
- Mostrar toast com total importado / erros
- Link "Baixar modelo CSV" que gera um arquivo exemplo

### 4. Hook `src/hooks/usePipedrive.ts`
Adicionar:
- `useCreateLead()` — mutation para insert manual + invalidar query de leads
- `useImportLeads()` — mutation para insert em lote
- (Opcional) `useDeleteLead()` para permitir remover leads manuais pelo `LeadDetail`

### 5. Backend
Nenhuma migration necessária — a tabela `leads` já aceita registros sem `pipedrive_id` e o campo `source` já é livre. A função `pipedrive-sync` só remove leads com `source = 'pipedrive'`, então leads manuais/CSV não serão apagados na sincronização.

### Arquivos
- `src/pages/Leads.tsx` (modificar — adicionar botões e dialogs)
- `src/components/LeadFormDialog.tsx` (novo)
- `src/components/LeadImportDialog.tsx` (novo)
- `src/hooks/usePipedrive.ts` (adicionar mutations)
- `package.json` (adicionar `papaparse` + `@types/papaparse`)
