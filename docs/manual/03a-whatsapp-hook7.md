# 03a. WhatsApp via Hook7

**Rota:** `/settings/integrations` → card **WhatsApp (Hook7)**
**Quando usar:** você vai enviar mensagens de WhatsApp na cadência.
**Pré-requisitos:** um número dedicado à prospecção (idealmente novo, não pessoal).

## O que é

Hook7 é a nossa camada sobre a Evolution API. Ele mantém uma instância de WhatsApp por empresa, gerencia o QR-Code de conexão e recebe respostas dos prospects via webhook.

## Passo a passo

1. Vá em **Configurações → Integrações → WhatsApp (Hook7)** e clique **Gerenciar instância**.
2. Clique **Criar instância**.
3. Um **QR-Code** aparece. Abra o WhatsApp no celular do número dedicado → **Aparelhos conectados → Conectar um aparelho** e escaneie.
4. O status muda para **Conectado** em alguns segundos.
5. Clique **Testar conexão** — ele envia uma mensagem para o próprio número para validar.

## Dicas

- **Use um chip dedicado** (não o WhatsApp pessoal). Se cair banimento, você não perde seu número pessoal.
- Comece com **poucas mensagens/dia** (30-50). O WhatsApp bane números novos com volume alto.
- Não desconecte o celular da internet — a Evolution precisa dele online.

## Erros comuns

- **QR-Code expirou**: clique **Gerar novo** e escaneie em até 60s.
- **Instância "desconectada" após 24h**: WhatsApp desloga aparelhos inativos. Reescaneie.
- **Mensagens não saem**: verifique se a janela de envio das configurações gerais permite o horário atual.

**Próximo passo →** [03b. Email](./03b-email-resend.md)
