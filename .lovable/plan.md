# Patch Logs (notas de versão para clientes)

Criar uma pasta de patch logs com um arquivo por dia, escrito em linguagem simples, para os clientes acompanharem o que muda no app.

## Estrutura

```text
docs/patch-logs/
  README.md          -> índice com links por data
  2026-08-19.md      -> notas do dia (beta 0.33 → 0.38)
```

Cada arquivo do dia segue o mesmo formato:

- Cabeçalho: data + versões cobertas
- Seções: Novidades, Melhorias, Correções
- Itens curtos, sem jargão técnico, focados no que o cliente percebe

## Conteúdo do arquivo 2026-08-19.md

- Novidades: verificação automática de números com WhatsApp (filtros na lista de leads); novo status "Em cadência" para leads recém-adicionados; status "Descartado" com KPI e filtro próprios no Acompanhamento; card de status de entrega de e-mail no lead.
- Melhorias: seleção rápida e envio em massa no MunicipIA; layout da tabela de leads (ícones e coluna do agente).
- Correções: "Abrir conversa" agora leva direto à conversa do lead; mensagens deixam de aparecer com canal errado (e-mail x WhatsApp); polling encerrado ao excluir instância WhatsApp.

## Como fica daqui pra frente

Regra registrada na memória do projeto: a cada bump de `APP_VERSION`, adicionar/atualizar o arquivo do dia em `docs/patch-logs/` com as mudanças em linguagem de cliente.

## Detalhes técnicos

- Apenas arquivos markdown em `docs/patch-logs/`; nenhuma alteração de código do app nesta etapa.
- Sem página no app por enquanto — se quiser exibir dentro do Leaderei depois, dá para renderizar esses arquivos numa rota `/novidades`.
