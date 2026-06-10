## Problema

Na conversa do Kiko, "Dia 12" gerou a resposta "Perfeito, Kiko — confirmando nossa conversa na sexta, 12 de junho, às 10:30. Até lá!" mas **nenhum booking foi criado no Cal.com**.

## Causa raiz

A IA classificou corretamente como `confirm_slot` e o branch de `confirm_slot` rodou. Detectou que o lead não tem e-mail cadastrado e (corretamente) decidiu pedir e-mail em vez de criar o booking — log `"No email available — asking lead before confirming booking"` confirma.

Porém, na hora de definir a resposta, o código é:

```ts
parsed.reply_message = parsed.reply_message ||
  "Perfeito! Para eu te enviar o convite com o link da reunião, qual o seu melhor e-mail?";
```

A IA já havia gerado `parsed.reply_message = "Perfeito, Kiko — confirmando..."`. O `||` manteve essa mensagem da IA, então o prospect viu uma confirmação falsa, nunca foi pedido o e-mail, e o `calcom-confirm-booking` nunca foi chamado.

## Correção em `supabase/functions/inbound-webhook/index.ts`

No ramo `confirm_slot` sem e-mail (linha ~881), **sobrescrever sempre** o `reply_message` com a pergunta de e-mail, descartando o texto que a IA gerou:

```ts
parsed.reply_message =
  "Perfeito! Para eu te enviar o convite com o link da reunião, qual o seu melhor e-mail?";
```

Removendo o `parsed.reply_message ||`. A IA não pode "confirmar" verbalmente quando o sistema sabe que o booking não foi criado.

O fluxo de captura de e-mail (`pending_email_slot_hold_id` já salvo na linha anterior) continua funcionando: na próxima inbound com e-mail, o webhook finaliza o booking.

## Fora do escopo
- Não vou alterar o prompt da IA, classify-intent ou outros ramos.
- Não vou tocar nos holds antigos.

## Arquivo tocado
- `supabase/functions/inbound-webhook/index.ts` (apenas, uma linha)
