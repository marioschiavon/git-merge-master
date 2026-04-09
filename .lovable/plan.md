

# Próximo Passo — Opção B: Dashboard com Métricas Reais

A Opção A (Cadências) está implementada. Seguindo a ordem recomendada, o próximo passo é o **Dashboard com dados reais**.

---

## O que será feito

### Dashboard.tsx — reescrever com dados do banco
- **Cards KPI** com queries reais:
  - Total de leads (count na tabela `leads`)
  - Leads novos nos últimos 7 dias
  - Leads por status (new/contacted/qualified/converted)
  - Taxa de conversão (converted / total)
- **Gráfico de leads** importados por semana (últimas 8 semanas) usando Recharts
- **Cadências ativas** — lista das cadências com status `active` e contagem de enrollments
- **Atividade recente** — últimas 10 entradas de `lead_activities`
- **Status da integração Pipedrive** — conexão ativa/inativa e último sync

### Hook useStats
- `useDashboardStats()` — busca counts agregados das tabelas `leads`, `cadences`, `cadence_enrollments`, `integrations`

### Dependências
- Recharts (já disponível no projeto via shadcn charts)

---

## Opção C (seguinte): Ações nos Leads
- Alterar status manualmente
- Adicionar notas/atividades
- Atribuir lead a membro da equipe

