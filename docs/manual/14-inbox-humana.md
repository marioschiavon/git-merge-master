# 14. Inbox humana

**Rota:** `/inbox`
**Quando usar:** quando a IA escala uma conversa para você — dúvida complexa, cliente irritado, negociação.
**Pré-requisitos:** [13](./13-conversas.md).

## O que é

Fila de conversas em que a IA "levantou a mão" pedindo humano. Regras que jogam para cá:
- Intent `duvida_preco` ou `negociacao`.
- 3+ trocas sem convergência.
- Lead com `handoff_required = true` (ex.: reclamação).

## Passo a passo

1. Abra **Inbox humana**. Conversas com SLA em vermelho vêm primeiro.
2. Selecione uma conversa. À direita há o **Copilot** com sugestão de resposta e contexto do lead.
3. Você pode:
   - **Responder manualmente** (texto livre).
   - **Aceitar sugestão IA** e mandar como está.
   - **Oferecer slots** de reunião direto pela tela.
   - **Devolver para o agente** (fim do takeover) — a cadência retoma.

## Dicas

- Trate a inbox como **fila crítica** — SLA vencido = lead perdido.
- Se a mesma dúvida aparece muito, adicione um item na Base de Conhecimento para a IA aprender.

**Próximo passo →** [15. Anotações](./15-anotacoes.md)
