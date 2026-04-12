

## Corrigir: Pausar cadência ao receber resposta mesmo se já "completed"

### Problema
O webhook só atualiza enrollments com `status = 'active'`. Se o lead responde após o último step (quando já está `completed`), a lógica de pausa não é acionada e o badge "💬 Lead respondeu" não aparece.

### Solução

**Arquivo: `supabase/functions/inbound-webhook/index.ts`**
- Alterar o filtro do update para aceitar tanto `active` quanto `completed`:
  - Usar `.in("status", ["active", "completed"])` em vez de `.eq("status", "active")`
- Isso garante que o badge apareça independentemente de em qual step o lead respondeu

**Arquivo: `src/components/CadenceDetail.tsx`**
- Ajustar a condição do badge e do botão "Retomar" para também considerar status `completed` com `paused_reason = 'lead_replied'`, já que o update mudará o status para `paused`

### Escopo
- 1 edge function atualizada (`inbound-webhook`)
- Redeploy da function
- Nenhuma mudança de UI necessária (o badge já verifica `status === 'paused'` e `paused_reason === 'lead_replied'`, e o update mudará o status para `paused`)

### Resultado
Quando qualquer lead responder — esteja no meio da cadência ou após completá-la — o enrollment será pausado com o motivo `lead_replied` e o badge aparecerá na lista.

