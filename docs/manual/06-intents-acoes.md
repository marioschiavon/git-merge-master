# 06. Intents & Ações

**Quando usar:** para decidir o que a IA faz quando o lead responde X, Y ou Z.
**Pré-requisitos:** [05](./05-scripts-ia.md).

## O que é

Uma **intent** é o tipo de resposta do lead (ex.: "quer agendar", "pediu mais info", "não é decisor", "negativa"). Uma **ação** é o que a IA/o sistema faz em resposta (ex.: oferecer 2 slots do Cal.com, marcar como qualificado, arquivar).

## Passo a passo

1. Abra **Configurações → Intents & Ações**.
2. Você verá a lista de intents ativas (com exemplos de treinamento).
3. Para cada intent, escolha a **ação padrão** (ex.: `interesse_agendar → oferecer_slots`).
4. Você pode adicionar exemplos manuais quando a IA classifica errado.

## Intents padrão

| Intent | Ação sugerida |
|---|---|
| `interesse_agendar` | Oferecer 2 slots + hold 2h |
| `pediu_mais_info` | Enviar case/one-pager e perguntar sobre reunião |
| `nao_e_decisor` | Perguntar por indicação e agradecer |
| `negativa` | Encerrar cadência, marcar `unqualified` |
| `duvida_preco` | Escalar para inbox humana |

## Dicas

- **Duvidoso? Escale.** Deixe intents ambíguas caindo em `inbox humana` — melhor humano do que IA errando.
- Revise mensalmente: intents novas aparecem com o uso.

**Próximo passo →** [07. Buscar leads no Apollo](./07-buscar-apollo.md)
