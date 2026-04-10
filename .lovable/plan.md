

## Plano: Corrigir envio de email no cadence-executor

### Problema
O `cadence-executor` chama `send-transactional-email` via `supabase.functions.invoke()` usando o service role client, mas `send-transactional-email` está configurado com `verify_jwt = true` no `config.toml`. O client criado no executor usa o service role key, que deveria funcionar — porém a chamada `supabase.functions.invoke()` feita server-side entre Edge Functions precisa passar o Authorization header explicitamente.

### Solução
Modificar o `cadence-executor/index.ts` para chamar `send-transactional-email` via `fetch` direto com o service role key no header Authorization, em vez de usar `supabase.functions.invoke()` que pode não estar passando o JWT corretamente no contexto server-to-server.

### Alteração

**Arquivo: `supabase/functions/cadence-executor/index.ts`**

Substituir o bloco que faz:
```ts
const { error: sendError } = await supabase.functions.invoke("send-transactional-email", { body: {...} });
```

Por uma chamada `fetch` direta:
```ts
const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey,
  },
  body: JSON.stringify({
    templateName: "cadence-outreach",
    recipientEmail: lead.email,
    idempotencyKey: `cadence-${enrollment.id}-step-${currentStep.step_order}`,
    templateData: {
      leadName: lead.name,
      subject: parsed.subject || `Mensagem para ${lead.name}`,
      messageBody: parsed.message,
    },
  }),
});
if (!sendRes.ok) {
  const errText = await sendRes.text();
  console.error(`Email send error for enrollment ${enrollment.id}:`, errText);
}
```

Também corrigir o log de `action` para registrar `"failed"` quando o envio falhar (atualmente registra `"sent"` mesmo com erro).

### Deploy
Redeployar `cadence-executor` após a alteração.

