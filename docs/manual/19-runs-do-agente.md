# 19. Runs do Agente

**Rota:** `/agent-runs`
**Quando usar:** auditoria — quando você quer saber por que a IA fez algo específico.
**Pré-requisitos:** agente SDR ativo em pelo menos um lead.

## O que é

Cada vez que o agente autônomo pensa sobre um lead, gera um **run** com: input recebido, tools chamadas, decisão final, texto gerado. É seu rastro de auditoria.

## Como usar

1. Filtre por lead ou por período.
2. Clique num run para ver o passo-a-passo do raciocínio.
3. Se algo saiu errado, você entende exatamente onde.

## Dicas

- Use os runs para calibrar: se o agente confundiu intent 5 vezes num tema, adicione instruções específicas na [Base de Conhecimento](./04-base-de-conhecimento.md).
- Runs antigos podem ser purgados após 90 dias — exporte se precisar guardar.

---

Você chegou ao fim do manual. Se algo mudar na plataforma, o time Liderei atualiza este manual e você recebe aviso. Boas prospecções! 🚀
