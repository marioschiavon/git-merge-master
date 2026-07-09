# 07. Buscar leads no Apollo

**Rota:** `/apollo`
**Quando usar:** cada vez que precisa de uma nova leva de leads.
**Pré-requisitos:** [03c. Apollo conectado](./03c-apollo.md).

## O que é

Interface para buscar contatos no Apollo direto do Leaderei e importá-los como leads.

## Passo a passo

1. Abra **Buscar no Apollo**.
2. Preencha filtros: cargo, empresa, indústria, país/cidade, tamanho da empresa.
3. Clique **Buscar**. A prévia mostra até 25 resultados.
4. Ajuste **Quantos leads importar** — não puxe 5.000 de uma vez.
5. Escolha uma **Lista** de destino ([09](./09-listas.md)) ou crie na hora.
6. Clique **Importar**. Cada lead entra com `enrichment_status = pending`.

## Regra prática — quanto importar?

- Um SDR humano trabalha bem **100-150 leads/mês**.
- Puxe **~200** de cada vez para, depois da qualificação, sobrarem 100 bons.
- Se a lista está muito heterogênea, importe **50** primeiro para calibrar.

## Dicas

- **Combine filtros** — buscar só por cargo dá muito ruído.
- Se você tem lista externa (CSV), pule esta etapa e use **Importar CSV** em [08. Leads](./08-leads.md).

**Próximo passo →** [08. Leads](./08-leads.md)
