## Atualizar `NYLAS_WEBHOOK_SECRET`

O valor atual do secret é placeholder. Substituir pelo real fornecido pela Nylas para o webhook `email-inbound-webhook`.

### Passo
1. Atualizar o secret `NYLAS_WEBHOOK_SECRET` no Lovable Cloud com o novo valor.
2. Nenhuma mudança de código necessária — `_shared/nylas.ts` já lê `NYLAS_WEBHOOK_SECRET` do env e valida HMAC-SHA256 em `verifyWebhookSignature`.
3. Após atualizar, testar disparando um webhook `message.created` no dashboard da Nylas e verificar logs de `email-inbound-webhook` (esperado: 200 em vez de 401 "invalid signature").

### Detalhes técnicos
- Usar `secrets--set_secret` (valor conhecido, sem interação do usuário) para gravar `NYLAS_WEBHOOK_SECRET = 3vVV7Zx17pGb3Mc4rmx-`.
- Edge function `email-inbound-webhook` já está deployada — pega o novo secret no próximo cold start automaticamente.
