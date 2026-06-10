## Problema
No `cadence-executor`, a consulta que carrega os leads matriculados em cadências busca apenas o campo `phone`, sem incluir `whatsapp`. Por isso `lead.whatsapp` chega sempre `undefined` na função e, no envio de WhatsApp, o fallback `lead.whatsapp || lead.phone` acaba dependendo só de `phone`. Quando o lead tem apenas o WhatsApp preenchido (como na imagem da Clotilde, em que copiei pra ambos), o passo é silenciosamente pulado.

## Correção
Adicionar `whatsapp` ao `select` de leads no `cadence-executor` para que a função enxergue o número certo.

```text
supabase/functions/cadence-executor/index.ts (linha 66)
- leads(id, name, email, phone, company_name, status)
+ leads(id, name, email, phone, whatsapp, company_name, status)
```

## Verificação rápida em outros pontos
Já confirmei que `send-outbound-message` e `slot-expiry-followup` já selecionam `whatsapp` corretamente — o bug é exclusivo do `cadence-executor`.

Após o fix, a regra de envio passa a ser: usa `lead.whatsapp` quando existir; se vazio, cai para `lead.phone`. Sem mudar nenhum outro comportamento.