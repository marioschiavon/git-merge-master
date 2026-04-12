

## Mostrar botão Resetar para todos os status de enrollment

### Problema
O botão "Re-testar" só aparece para enrollments com status `completed`, `bounced` ou `paused`. Enrollments `active` ou `replied` não mostram o botão.

### Solução
**Arquivo: `src/pages/CadencesDashboard.tsx` (linha 277)**

Mostrar o botão para **todos** os status, removendo a condição restritiva. O botão permitirá resetar qualquer enrollment de volta ao Step 1.

Alterar de:
```tsx
{(e.status === "completed" || e.status === "bounced" || e.status === "paused") && (
```
Para:
```tsx
{/* Sempre exibir botão de reset */}
{(
```

Ou seja, remover a condição de status e sempre renderizar o botão.

### Escopo
- 1 arquivo, 1 linha alterada

