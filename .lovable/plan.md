## Diagnóstico

Verifiquei o fluxo de anotações. O problema é específico ao **rejeitar** uma aprovação em `/approvals`:

- No `approval-execute` (edge function), o ramo `if (action === "reject")` faz um `return` na linha ~105 **antes** de chegar ao bloco que grava em `message_annotations` (linha ~251). Ou seja, quando o operador rejeita e escreve uma nota/motivo ("correção sinalizada para a IA"), o registro nunca é criado.
- No caminho de **aprovar** (com ou sem edição), a anotação é salva corretamente.
- A rota `/annotations`, o hook `useAnnotations` e as policies RLS estão OK.

Também há uma inconsistência menor: `useBulkApprovalExecute` (rejeição em lote na tela `/approvals`) não envia `note`, então também não gera anotação — só o `rejection_reason` fica em `approval_requests`.

## Correção

1. **`supabase/functions/approval-execute/index.ts`**
   - Extrair a lógica de "salvar anotação" para uma função helper local (`saveAnnotation`) que funciona tanto para reject quanto para approve, montando `context_snapshot` a partir de `approval`, `finalPayload`/`rejection_reason` e mensagens recentes.
   - Chamar `saveAnnotation` no ramo de **reject** (quando `trimmedNote` OU `rejection_reason` estiver presente — assim o motivo do rejeitar também vira aprendizado, mesmo sem nota extra) antes do `return`.
   - Manter a chamada no fim do ramo de **approve** como está.
   - `human_action`: `"rejected"` no reject, `"edited"` se houve `edited_payload`, senão `"approved"`.

2. **`src/hooks/useApprovals.ts`** (`useBulkApprovalExecute`)
   - Aceitar `note?: string` no input e repassar para `approval-execute`, para que rejeições em lote também gerem anotação quando o operador preencher o motivo.

3. **`src/pages/Approvals.tsx`**
   - Passar a `rejection_reason` também como `note` no bulk reject (ou adicionar um pequeno input opcional), garantindo que "Rejeitar selecionadas" produza pelo menos uma anotação com o motivo digitado.

## Verificação

- Rejeitar uma aprovação em `/approvals` com nota → aparece imediatamente em `/annotations` com `human_action = "rejected"` e o motivo dentro de `context_snapshot.rejection_reason`.
- Rejeitar em lote com motivo → uma anotação por aprovação, todas com o mesmo motivo.
- Aprovar com edição → continua salvando `human_action = "edited"` (regressão coberta).

Sem mudanças em UI de leitura, schema ou policies — apenas o fluxo de gravação.
