# 08. Leads

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

## Verificação de WhatsApp

Nem todo telefone tem WhatsApp. O Leaderei confere o número diretamente na sua instância conectada e mostra o resultado:

- **Ícone verde/normal** — número confirmado no WhatsApp.
- **Ícone esmaecido** — ainda não verificado (o envio continua normal).
- **Ícone riscado** — número **não** está no WhatsApp; o envio por WhatsApp é bloqueado e a cadência multicanal usa e-mail.

Como verificar:
- **Em lote:** selecione os leads → **Verificar WhatsApp**.
- **Individual:** abra o lead → **Verificar agora**.
- **Automático:** uma rotina diária verifica os pendentes, e todo lead é verificado antes do primeiro envio.

Há também o filtro **WhatsApp válido**, para trabalhar só com números confirmados. A verificação exige uma instância WhatsApp conectada; sem ela o status fica como "não verificado" e nada é bloqueado. Resultados são revalidados a cada 30 dias.

## Lista "Não prospectar"

Em **Configurações → Não prospectar** você cadastra prefeituras (município + UF) ou empresas (nome ou site) que não devem ser abordadas — por exemplo, quem já é cliente ou está em negociação.

- Leads dessas organizações ganham o selo **Protegido** e não podem entrar em cadência.
- O MunicipIA ignora essas prefeituras ao enviar contatos para o Leaderei (o aviso final mostra quantas foram ignoradas).
- Se um lead já estava numa cadência, o próximo envio é suspenso e fica registrado no histórico.
- No detalhe do lead, o botão **Não prospectar** protege a organização dele com um clique.
- **Proteção automática** (ligada por padrão): reunião agendada → "Em negociação"; lead convertido → "Cliente".

## Leads vindos do MunicipIA

- Só entram contatos com **telefone ou e-mail**. Municípios sem contato ficam de fora, e o aviso final mostra quantos foram deixados de fora.
- Cada envio vira uma **Lista** com nome (ex.: "MunicipIA 29/09 14h30"), em Leads → Listas.
- O WhatsApp dos novos leads é **verificado automaticamente** quando há uma conexão de WhatsApp ativa. O enriquecimento também começa sozinho.
- Use os filtros **Origem: MunicipIA** e **Pronto para cadência** para encontrar o que acabou de chegar e enviar direto para a cadência.

## Filtrar por lista e excluir em massa

- Use o filtro **Lista** para ver só os leads de uma importação. A caixa do topo da tabela seleciona todos os filtrados.
- O botão **Excluir** apaga os selecionados. Quem já recebeu mensagem ou está em cadência só é apagado se você marcar essa opção.
- Na importação, a coluna **Celular** vira o WhatsApp do lead quando não houver uma coluna WhatsApp.

## Paginação

A lista mostra 50 leads por página. No rodapé da tabela você vê quantos leads existem no total ("Mostrando 1–50 de 3.420 leads"), pode escolher 25, 50, 100 ou 250 por página e avançar/voltar.

Atenção: a caixa de seleção do topo marca **todos os leads do filtro atual**, não apenas os da página visível. Isso permite, por exemplo, selecionar de uma vez todos os leads de uma lista importada.
