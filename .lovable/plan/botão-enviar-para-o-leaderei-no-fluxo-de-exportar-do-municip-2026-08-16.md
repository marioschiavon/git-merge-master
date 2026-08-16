# Botão "Enviar para o Leaderei" no fluxo de Exportar do MunicipIA

## O que está acontecendo

O envio para o Leaderei já existe no MunicipIA, mas em outros dois lugares — não no botão **Exportar** que você abriu:

1. Painel de **prospecção em lote** (`src/routes/index.tsx`, linha ~567): botão "Enviar para o Leaderei" que envia os municípios processados no lote.
2. Página de **detalhe do município** (`src/routes/municipio.$ibgeId.tsx`, linha ~142): envia aquele município.

O diálogo **Exportar leads** (o que abre pelo botão Exportar da barra de filtros) só tem "Exportar CSV" e "Exportar Excel (.xlsx)". Além disso existe um componente `src/components/ExportButtons.tsx` que já tem o botão do Leaderei, mas ele não é usado em lugar nenhum do app (código órfão, com uma segunda implementação de handshake em `src/lib/leaderei-bridge.ts`).

Ou seja: falta o botão exatamente no lugar onde você procurou.

## O que fazer

No diálogo **Exportar leads**, ao lado de "Exportar CSV" e "Exportar Excel", entra um terceiro botão **Enviar para o Leaderei**, usando os mesmos filtros e a mesma quantidade já escolhidos no diálogo. Ele só aparece quando o MunicipIA está aberto dentro do Leaderei (sessão conectada); fora disso, fica oculto, como os outros pontos de envio.

Ao clicar: busca os municípios com os filtros do diálogo, converte para o formato de lead e envia; ao final aparece o toast "X lead(s) importado(s)".

## Detalhes técnicos

Todas as mudanças são no projeto **MunicipIA** (Municipal Connect Pro) — o lado do Leaderei já está pronto e responde ao handshake.

- `src/routes/index.tsx`
  - No `DialogFooter` do diálogo de exportação, adicionar botão "Enviar para o Leaderei" visível quando `leaderei.connected`.
  - Nova mutation que reaproveita `exportFn({ ... })` (mesmos filtros de UF, busca, status, faixa, score, contato e quantidade) e, em vez de gerar arquivo, mapeia cada item com `buildLeadereiRow(...)`, filtra por `rowTemContato` e chama `leaderei.sendRows(rows)`.
  - Estado de carregando próprio (`Loader2`) e fechamento do diálogo no sucesso.
- Limpeza: remover `src/components/ExportButtons.tsx` e `src/lib/leaderei-bridge.ts` (não usados) para deixar só a implementação de `src/hooks/useLeaderei.ts` + `src/lib/leaderei.ts`.
- Bump da versão do MunicipIA.

## Verificação

Abrir o Leaderei → menu **MunicipIA** e confirmar o selo "Conectado ao Leaderei" no cabeçalho. Se ele não aparecer, o handshake não completou e nenhum dos botões de envio surge — nesse caso o ajuste é na sessão (token/origem), não no diálogo.

## Como aplicar

Eu só tenho acesso somente-leitura ao projeto MunicipIA. Depois de aprovar, abra o projeto MunicipIA no Lovable e peça a implementação acima — posso gerar o código pronto para colar se preferir.
