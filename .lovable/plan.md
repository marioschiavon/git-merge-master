## Problema

No webhook do WhatsApp (Hook7), quando chega uma mensagem de um número **que não é um lead cadastrado**, o sistema hoje:

1. Cria automaticamente um lead novo com `source: "whatsapp_inbound"` (arquivo `supabase/functions/hook7-webhook/index.ts`, linhas 113–131).
2. Encaminha a mensagem para `inbound-webhook`, que dispara o pipeline de IA e pode responder.

Resultado: qualquer pessoa que mandar mensagem para o número recebe resposta automática, mesmo sem estar cadastrada.

Os outros webhooks (`zapi-webhook`, `twilio-whatsapp-webhook`) já têm o comportamento correto — se não acham lead, ignoram. Só o Hook7 está criando lead novo.

Observação: grupos, broadcasts e newsletters já são ignorados corretamente (linhas 33–37, 76–79).

## Mudança proposta

Em `supabase/functions/hook7-webhook/index.ts`, dentro de `handleMessage`:

- Se `findLeadByPhone` **não** encontrar lead, **não criar** um lead novo e **não disparar** o pipeline de IA.
- Registrar log claro (`ignored: no matching lead`) e retornar `"ignored"`.
- Para mensagens `IsFromMe: true` (outbound enviado pelo próprio celular fora do sistema), manter o comportamento atual de só gravar se houver lead — caso contrário ignorar.

Efeito: o agente só responde números que já estão como lead na base. Números desconhecidos são silenciosamente ignorados.

## Detalhes técnicos

Alterar o bloco após `let lead = await findLeadByPhone(...)`:

```ts
if (!lead) {
  console.log("[hook7-webhook] ignored: phone não corresponde a nenhum lead", {
    company_id: company.id,
    phone: phoneFormatted,
    external_id: externalId,
  });
  return "ignored";
}
```

Remover todo o bloco de `insert` em `leads` (linhas 114–131 atuais).

Nenhuma outra função precisa mudar. `zapi-webhook` e `twilio-whatsapp-webhook` já se comportam assim.

## Documentação

Adicionar nota em `docs/manual/03a-whatsapp-hook7.md` na seção "Dicas importantes":

> **Só responde leads cadastrados.** Mensagens vindas de números que não estão como lead na base são ignoradas silenciosamente — o Leaderei não cria lead automático nem responde. Para atender um novo contato, cadastre-o em Leads primeiro.

## Fora de escopo

- Não mexer em grupos/broadcasts (já ignorados).
- Não mudar `zapi-webhook` nem `twilio-whatsapp-webhook`.
- Não alterar comportamento de e-mail (`inbound-email-webhook`).