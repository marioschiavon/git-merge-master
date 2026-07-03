## Ajustes no WhatsApp — Integrações

### 1. Melhorar a copy de orientação no WhatsAppManagerDialog
**Arquivo:** `src/components/WhatsAppManagerDialog.tsx`

A descrição atual (linhas 228–230) é técnica e passiva. Substituir por uma frase que oriente o usuário sobre o benefício real: enviar mensagens do agente aos leads.

**Nova copy sugerida:**
> Conecte o WhatsApp da sua empresa para que o agente envie mensagens aos seus leads e acompanhe respostas automaticamente.

### 2. Corrigir status "desconectado" no card de Integrações
**Arquivo:** `src/pages/settings/Integrations.tsx`

O card do WhatsApp na grade de integrações continua exibindo "Desconectado" mesmo quando existem instâncias ativas. O componente já consulta `hook7_instances`, mas o status agregado pode não estar refletindo corretamente.

**Investigação necessária:**
- Verificar se a query `hook7_instances_summary` está retornando dados para a empresa do usuário logado.
- Conferir se o mapeamento de `status` da instância para `StatusKey` do card está correto.
- Garantir que o cache do React Query não esteja exibindo estado obsoleto após criação/conexão de instâncias.

**Possível correção:**
- Invalidar a query `hook7_instances_summary` ao abrir/fechar o `WhatsAppManagerDialog`.
- Ou garantir que o `refetch` da lista de instâncias atualize o estado agregado do card imediatamente.

### Escopo
Apenas ajustes de frontend (copy e lógica de status). Nenhuma alteração de backend ou banco de dados.