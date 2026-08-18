# 12. Acompanhamento de cadências

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

## Como saber o próximo envio e se a cadência está funcionando

Sim, dá para ver — em três lugares:

**1. Coluna "Próxima execução" (Acompanhamento)**
Selecione a cadência e veja, lead a lead, a coluna **Próxima execução**: canal, número do step e a data/hora exata do próximo disparo (ex.: `19/08 09:15`), com o assunto/prévia da mensagem no tooltip. Se aparecer "—", o lead não tem próximo envio agendado (concluído, pausado ou respondeu).

**2. Fila de WhatsApp (Cadências e Aprovações)**
No topo dessas telas há a faixa **Fila WhatsApp** com: quantas mensagens estão *enviando*, quantas estão *na fila*, quantas foram *enviadas na última hora*, falhas nas últimas 24h e o ETA da próxima ("próxima em ~12min"). É o indicativo mais direto de que o motor está rodando.

**3. Ficha do lead → card "Entrega de email"**
Mostra o status de cada tentativa (enviado, falhou, em fila), remetente, horário e o erro quando houver.

### Sinais de que está tudo certo
- KPIs de **Ativos** > 0 e a coluna Próxima execução com datas futuras.
- Contador "enviadas na última hora" subindo ao longo do dia.
- Última mensagem dos leads avançando de step.

### Sinais de problema
- Próxima execução no passado e nada saindo → fila parada (janela de envio fora do horário, limite diário atingido ou instância WhatsApp desconectada).
- Muitas falhas em 24h → veja Integrações (WhatsApp/Email) e o card de entrega no lead.

> Observação: os envios são espaçados de propósito (jitter + limite diário + aquecimento) para proteger a reputação do número/domínio. Por isso o próximo envio raramente é "agora".
