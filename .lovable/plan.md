

## Proteção de Rotas Master + Ativar/Inativar Empresa

### 1. Componente `RequireMasterAdmin`
Criar um componente wrapper de rota que verifica `isMasterAdmin` do `useAuth()`. Se não for master, redireciona para `/dashboard`. Usado para envolver as rotas `/master` e `/master/companies` no `App.tsx`.

### 2. Bloqueio de acesso para empresas inativas
No `useAuth`, após buscar o `companyId`, verificar o `status` da empresa na tabela `companies`. Se `status === 'inactive'`, fazer sign out automático e redirecionar para `/auth` com uma mensagem de erro. O `master_admin` não será bloqueado (ele não depende de empresa).

### 3. Toggle ativar/inativar na página de Empresas
Adicionar um botão/switch na tabela de empresas (coluna "Ações") que alterna o status entre `active`/`trial` e `inactive`. Ao inativar, os usuários daquela empresa serão impedidos de acessar na próxima verificação de sessão.

### Detalhes técnicos

**Arquivo: `src/components/RequireMasterAdmin.tsx`** (novo)
- Usa `useAuth()` para checar `isMasterAdmin` e `loading`
- Renderiza `<Outlet />` se master, `<Navigate to="/dashboard" />` se não

**Arquivo: `src/App.tsx`**
- Envolver rotas `/master` e `/master/companies` dentro de `<Route element={<RequireMasterAdmin />}>`

**Arquivo: `src/hooks/useAuth.tsx`**
- Após buscar `companyId`, buscar `status` da empresa
- Se `status === 'inactive'` e não é `master_admin`, chamar `signOut()` e setar um flag para mostrar mensagem

**Arquivo: `src/pages/master/Companies.tsx`**
- Adicionar coluna "Ações" na tabela
- Botão/switch para alternar status (`active` ↔ `inactive`)
- Confirmação antes de inativar (AlertDialog)

**Nenhuma migração necessária** — a coluna `status` já existe na tabela `companies` com os valores `active`, `trial`, `inactive`.

