# 08. Leads

**Rota:** `/leads`
**Quando usar:** revisar, filtrar, qualificar e disparar leads em massa para cadência.
**Pré-requisitos:** [07](./07-buscar-apollo.md) ou leads importados por CSV.

## O que é

A tela central de gestão de leads. Cada lead tem:
- **Score** (0-100) — quanto maior, mais aderente ao seu ICP.
- **Status** (Novo, Contatado, Qualificado, Desqualificado, Convertido).
- **Enrichment** (não enfileirado, pendente, processando, concluído, falhou).
- **Redes sociais** já raspadas (LinkedIn, Instagram, Facebook) com resumos gerados por IA.

## Filtros disponíveis

- **Busca** por nome, email, empresa.
- **Status**.
- **Score ≥** (slider 0–100) — só mostra leads com score mínimo.
- **Só enriquecidos** — esconde os que ainda não terminaram o enrichment.

## Ações em lote (P01)

1. Marque a caixa dos leads (ou o master no topo para todos da página).
2. Aparece a barra: **X selecionado(s)** com botões:
   - **Enviar para cadência** → escolhe cadência ativa → confirma. Leads já inscritos são ignorados.
   - **Descartar** → marca todos como `Desqualificado`.

Fluxo recomendado para **triagem**: filtre `Só enriquecidos` + `Score ≥ 60` → selecione todos → **Enviar para cadência**. Resto vira `Descartar` ou fica para revisão futura.

## Enriquecimento

- Novos leads entram como `pending` e o robô processa em background (site, redes, contatos, resumo IA).
- Se você importou muitos e limitou processamento, aparece o botão **Enriquecer mais (N)** — libera N leads em espera.
- Cada lead tem card lateral "Redes sociais & enriquecimento" com:
  - Resumo LinkedIn (IA)
  - Resumo Instagram (IA)
  - Bio e últimos posts raspados

## Erros comuns

- Disparar cadência **antes** do enrichment terminar → mensagens genéricas. Use o filtro `Só enriquecidos`.
- Descartar leads em massa sem revisar — perde bons por erro de score.

**Próximo passo →** [09. Listas](./09-listas.md)
