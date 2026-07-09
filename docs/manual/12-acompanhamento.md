# 12. Acompanhamento de cadências

**Rota:** `/cadences/dashboard`
**Quando usar:** para saber, em tempo real, o que cada cadência está fazendo.
**Pré-requisitos:** cadências ativas.

## O que é

Um painel operacional com uma linha por cadência ativa e métricas do dia/semana: inscritos, mensagens enviadas, respostas, reuniões agendadas, taxas.

## O que olhar

- **Taxa de resposta** — se está < 5%, sua mensagem está genérica ou o público está errado.
- **Taxa de reunião** — norte principal.
- **Erros de envio** — se aparecer muito "phone_missing" ou "not_on_whatsapp", volte no enrichment.
- **Fila pausada** — geralmente por janela de envio ou instância WhatsApp desconectada.

## Ações

Clique numa cadência para abrir a lista de leads inscritos com progresso individual (em qual passo está, última mensagem, próximo envio).

**Próximo passo →** [13. Conversas](./13-conversas.md)
