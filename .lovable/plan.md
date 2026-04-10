

## Plano: Configurar recebimento de respostas de email para o SDR autônomo

### Problema atual
Os emails são enviados com remetente `noreply@internetsegura.com.br`. Quando o prospect responde, essa resposta não chega em lugar nenhum — não há servidor de email recebendo mensagens nesse endereço e encaminhando para o webhook `inbound-email-webhook`.

### Solução

Para fechar o loop de conversação por email, precisamos de **2 coisas**:

**1. Mudar o remetente para um endereço com Reply-To funcional**
- Alterar de `noreply@internetsegura.com.br` para algo como `sdr@internetsegura.com.br` ou `contato@internetsegura.com.br`
- Ou adicionar um header `Reply-To` apontando para um endereço que encaminhe para o webhook

**2. Configurar recebimento de email inbound**
O sistema de email do Lovable Cloud só envia emails — não recebe. Para receber respostas, precisamos de um serviço externo de inbound email routing. Opções:

- **Mailgun Inbound Routes** — Configura uma rota que encaminha emails recebidos em um endereço para a URL do webhook `inbound-email-webhook`
- **SendGrid Inbound Parse** — Similar ao Mailgun
- **Cloudflare Email Routing** — Pode encaminhar emails do domínio `internetsegura.com.br` para um webhook (gratuito, já que você usa Cloudflare)

### Recomendação: Cloudflare Email Routing + Email Workers

Como você já usa Cloudflare para o domínio `internetsegura.com.br`:

1. **Criar um Email Worker no Cloudflare** que recebe emails em `sdr@internetsegura.com.br` e faz POST do conteúdo para a edge function `inbound-email-webhook`
2. **Alterar o `send-transactional-email`** para usar `Reply-To: sdr@internetsegura.com.br` no lugar de `noreply`
3. **Configurar MX records** no Cloudflare para email routing (se ainda não existir)

### Ações técnicas

1. Atualizar `send-transactional-email/index.ts` — adicionar header `Reply-To` com endereço funcional no payload do email enqueued
2. Atualizar o template de email para não mostrar "noreply" ao prospect
3. Documentar a configuração necessária no Cloudflare (Email Routing + Worker)
4. Testar o fluxo completo: envio → resposta → webhook → IA → resposta automática

### Pergunta necessária
Qual serviço de inbound email você prefere usar? Cloudflare Email Routing (grátis, já usa Cloudflare), Mailgun, ou outro?

