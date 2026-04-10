

## Plano: Permitir re-teste de envio de email na cadência

### Problema
O enrollment do lead está com status `completed` e não pode ser re-executado. Além disso, o domínio de email ainda está pendente de verificação DNS.

### Solução
Adicionar um botão "Reenviar / Re-testar" no dashboard de acompanhamento que reseta o enrollment para re-execução, e criar uma forma rápida de re-testar.

### Alterações

**1. Novo hook `useResetEnrollment` em `src/hooks/useCadences.ts`**
- Mutation que atualiza o enrollment: `status = 'active'`, `current_step = 1`, `next_execution_at = now()`, `completed_at = null`
- Invalida queries de enrollments após sucesso

**2. Botão "Re-testar" no Dashboard (`src/pages/CadencesDashboard.tsx`)**
- Na aba "Leads", adicionar botão ao lado de cada lead com status `completed` ou `failed`
- Ao clicar: reseta o enrollment e mostra toast "Enrollment resetado, clique Executar Agora"

**3. Verificação de domínio antes de executar**
- No botão "Executar Agora", mostrar aviso se o domínio de email ainda estiver pendente
- Informar que a mensagem será gerada e logada, mas o email só será entregue após verificação do domínio

### Sobre o domínio
O domínio `notify.internetsegura.com.br` ainda está **Pendente**. A propagação DNS pode levar até 72h. Você pode acompanhar em **Cloud → Emails**. Enquanto isso, o executor vai gerar a mensagem e logar, mas o email não chegará na caixa de entrada.

### Arquivos modificados
1. `src/hooks/useCadences.ts` — novo mutation `useResetEnrollment`
2. `src/pages/CadencesDashboard.tsx` — botão re-testar + aviso de domínio pendente

