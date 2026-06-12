## Diagnóstico

A tabela `sdr_agent_runs` está vazia (0 linhas) e o edge function `sdr-agent` nunca registrou boot nos logs, apesar de mensagens inbound chegando (vi vários `intent routed:` em `inbound-webhook` nos últimos minutos).

Testei o `sdr-agent` diretamente via curl e ele está deployado e respondendo (retornou erro esperado "lead not found"). Portanto a função existe — o problema é que **o `inbound-webhook` nunca consegue disparar a chamada**.

Duas causas no `supabase/functions/inbound-webhook/index.ts`:

### 1. Fire-and-forget é morto pelo runtime (causa raiz)
Linhas 444-457:
```ts
if (!earlyParsed && companyId && leadData?.id) {
  try {
    supabase.functions.invoke("sdr-agent", { body: {...} })
      .catch((e) => console.error("sdr-agent shadow invoke error:", e));
  } catch (e) { ... }
}
```
A invocação é fire-and-forget (sem `await`, sem `EdgeRuntime.waitUntil`). No runtime de Edge Functions, quando o handler retorna o `Response` ao cliente, promises pendentes são canceladas — a requisição HTTP para `sdr-agent` nunca chega a ser enviada. Por isso não há boot do `sdr-agent` nem log de erro.

### 2. Chave `}` faltando no bloco shadow
O `if` da linha 445 não é fechado antes do próximo `if (leadData?.id) {` na linha 462. O bloco shadow está malformado (todo o restante do handler virou filho desse `if`). Pode estar parseando por acaso devido a outro `}` mais adiante, mas precisa ser fechado corretamente.

## Correção

Em `supabase/functions/inbound-webhook/index.ts`, substituir o bloco shadow (linhas 444-457) por uma invocação que sobrevive ao retorno do handler usando `EdgeRuntime.waitUntil`, e fechar o `if` corretamente:

```ts
// SHADOW MODE: run unified sdr-agent in parallel for comparison.
if (!earlyParsed && companyId && leadData?.id) {
  try {
    const shadowPromise = supabase.functions
      .invoke("sdr-agent", {
        body: {
          lead_id: leadData.id,
          conversation_id: convId,
          trigger: "inbound",
          mode: "shadow",
        },
      })
      .then(({ error }) => {
        if (error) console.error("sdr-agent shadow invoke error:", error);
      })
      .catch((e) => console.error("sdr-agent shadow invoke threw:", e));

    // Keep the promise alive after the handler returns its Response
    // @ts-ignore - EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(shadowPromise);
    }
  } catch (e) {
    console.error("sdr-agent shadow trigger error:", e);
  }
}
```

## Validação

1. Disparar uma mensagem inbound de teste (qualquer conversa nova).
2. Conferir logs de `inbound-webhook` (deve sair sem erros) e de `sdr-agent` (deve aparecer boot + execução).
3. `SELECT count(*) FROM sdr_agent_runs` — deve passar a crescer.
4. Abrir a tela `/agent-runs` e clicar "Atualizar" — runs devem aparecer.

Nenhuma outra alteração de UI ou lógica de negócio é necessária.