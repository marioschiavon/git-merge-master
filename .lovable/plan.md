# Correção: mensagem aprovada para o contato indicado não é enviada

## O que aconteceu no teste
- O cartão foi lido, o lead "Suporte S7" foi criado e a primeira mensagem foi para Aprovações. Até aqui, tudo certo.
- Quando você aprovou, o app marcou a mensagem como "aprovada", mas **não enviou nada**. Ela não entrou na fila do WhatsApp, e por isso a conversa aparece vazia.
- Causa: esta primeira mensagem não pertence a nenhuma cadência. A aprovação só sabia enviar primeiras mensagens que vêm de uma cadência. Sem cadência, ela era descartada sem avisar.
- Problema extra: o Mario recebeu dois agradecimentos. Um veio do fluxo do cartão ("Muito obrigado pelo contato!") e outro da IA ("Combinado, Mario! Agradeço a indicação...").

## O que vai mudar
1. **Envio após a aprovação**: se a primeira mensagem aprovada não tiver cadência, ela vai para a fila do WhatsApp (ou do e-mail) como qualquer resposta aprovada. Assim ela aparece na conversa e o status só fica "enviada" quando a entrega acontecer de fato.
2. **Sem descarte silencioso**: qualquer aprovação que não tenha como ser enviada vai ficar marcada como "falhou", com o motivo à vista, e não mais como "aprovada".
3. **Um agradecimento só**: quando o cartão é processado, a IA não responde de novo aquela mesma mensagem. Fica apenas o agradecimento do fluxo do cartão.
4. **Recuperar o teste**: reenviar a mensagem já aprovada para o Suporte S7, para ela chegar agora.
5. Subir a versão para beta 0.64 e registrar nas notas da versão.

## Detalhes técnicos
- `approval-execute`: no ramo `first_message`/`cadence_step`, quando não houver `enrollment_id`, usar o mesmo envio do `sdr_reply`: `enqueueWhatsAppSend` com `source: "approval"`, status `queued` e `queue_id` no contexto. Canal e-mail vai por `send-outbound-email`. Se nenhum ramo enviar, gravar `executionError`.
- `whatsapp-webhook`: quando `handleSharedContacts` criar indicados, não disparar o pipeline de IA para essa mensagem de entrada.
- Recuperação: colocar na fila a aprovação `56e525dc…` (lead `ca074f4f…`) e voltar o status dela para `queued`.
- Publicar `approval-execute` e `whatsapp-webhook`.
