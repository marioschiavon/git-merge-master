# 05. Scripts IA

**Quando usar:** para criar/versionar templates que a IA usa como ponto de partida em cadências.
**Pré-requisitos:** [04](./04-base-de-conhecimento.md).

## O que é

Scripts são **templates de mensagem** com variáveis (`{{nome}}`, `{{empresa}}`) que a IA personaliza para cada lead usando a Base de Conhecimento. Diferente da geração 100% livre, o script mantém estrutura consistente.

## Passo a passo

1. Vá em **Scripts IA → Novo script**.
2. Escolha o **canal** (WhatsApp/Email) e o **objetivo** (apresentação, follow-up, quebra-gelo).
3. Escreva a mensagem base com placeholders:
   ```
   Oi {{primeiro_nome}}, vi que a {{empresa}} está expandindo em {{cidade}}.
   Faz sentido bater um papo de 15min?
   ```
4. Clique **Gerar variações IA** — a IA cria 3 versões distintas com base na sua Instruções de Abordagem e nos Destaques.
5. Aprove/edite/descarte as variações.

## Dicas

- Mensagens curtas (2-4 linhas) têm muito mais resposta.
- Uma pergunta objetiva no final quase sempre supera uma frase declarativa.
- Não escreva "espero que esteja bem" — todo mundo escreve, ninguém lê.

**Próximo passo →** [06. Intents & Ações](./06-intents-acoes.md)
