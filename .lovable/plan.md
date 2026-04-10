

## Plano: Dashboard de Acompanhamento de Cadências

### Visão Geral
Criar uma nova página `/cadences/dashboard` com visão detalhada de cada cadência: timeline visual dos steps, status de execução por lead, e log de mensagens enviadas.

### Componentes a Criar

**1. Nova página `src/pages/CadencesDashboard.tsx`**
- Seletor de cadência no topo (dropdown com todas as cadências da empresa)
- Três seções principais: Timeline, Leads/Status, Log de Mensagens

**2. Seção Timeline Visual**
- Timeline horizontal/vertical mostrando cada step da cadência selecionada
- Cada nó mostra: canal (emoji/ícone), assunto, delay em dias
- Indicador visual de quantos leads já passaram por cada step (barra de progresso ou contagem)
- Steps já executados em verde, step atual em azul, futuros em cinza

**3. Seção Status por Lead**
- Tabela com todos os leads enrolled na cadência
- Colunas: Nome, Email, Step Atual, Status (badge colorido), Próxima Execução, Última Execução
- Filtro por status (ativo, concluído, respondeu, bounce, pausado)

**4. Seção Log de Mensagens**
- Lista de mensagens enviadas (da tabela `execution_logs`)
- Cada entrada mostra: lead, canal, step, conteúdo da mensagem (expandível), data/hora, ação (sent/reply/etc)
- Dados vindos de `execution_logs` com join em `leads` e `cadence_steps`

### Dados Utilizados (já existentes no banco)
- `cadences` — lista de cadências
- `cadence_steps` — steps de cada cadência
- `cadence_enrollments` (join com `leads`) — leads e seu progresso
- `execution_logs` — log de cada mensagem enviada por step/lead

### Hook `src/hooks/useCadenceDashboard.ts`
- Query para buscar enrollments com progresso agregado por step
- Query para buscar execution_logs com dados do lead e step
- Filtros por cadência selecionada

### Rota e Navegação
- Adicionar rota `/cadences/dashboard` em `App.tsx`
- Adicionar link "Acompanhamento" no sidebar dentro do grupo Operação (abaixo de Cadências) com ícone `Activity`

### Detalhes Técnicos
- Usa queries existentes do Supabase (RLS por `company_id` já configurado)
- `execution_logs` tem policy SELECT para authenticated via `get_user_company_id`
- Componentes: Card, Badge, Table, Tabs, Progress, Select do shadcn/ui
- Recharts para timeline visual (ou CSS puro com flexbox)

### Arquivos Modificados
1. `src/pages/CadencesDashboard.tsx` — nova página
2. `src/hooks/useCadenceDashboard.ts` — novo hook
3. `src/App.tsx` — adicionar rota
4. `src/components/AppSidebar.tsx` — adicionar link na navegação

