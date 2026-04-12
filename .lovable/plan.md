

## Corrigir: Re-testar não atualiza o dashboard

### Problema
O botão "Re-testar" chama `useResetEnrollment`, que após sucesso invalida apenas a query `["cadence_enrollments"]`. Porém, o dashboard usa queries diferentes: `["cadence_dashboard_enrollments"]`, `["cadence_dashboard_logs"]` e `["cadence_step_progress"]`. Por isso os dados não atualizam e o botão continua visível (o enrollment ainda mostra status "completed" na tela).

### Solução

**Arquivo: `src/hooks/useCadences.ts` — função `useResetEnrollment`**
- No `onSuccess`, adicionar invalidação das queries do dashboard:
  - `["cadence_dashboard_enrollments"]`
  - `["cadence_dashboard_logs"]`
  - `["cadence_step_progress"]`

### Escopo
- 1 arquivo editado, 3 linhas adicionadas
- Nenhuma mudança de backend

