# Abrir conversa direto do Acompanhamento

Hoje o botão "Abrir conversa" no painel do lead navega para `/conversations?lead=<id>`, mas a página de Conversas ignora esse parâmetro na URL: ela só guarda o lead selecionado em estado local. Por isso o usuário cai na lista geral.

## O que fazer

1. Em Conversas, ler o parâmetro `lead` da URL e abrir automaticamente a conversa daquele lead assim que a lista carregar.
2. Manter a URL sincronizada: ao selecionar uma conversa, atualizar o parâmetro; ao voltar para a lista, removê-lo (permite recarregar/compartilhar o link e usar o botão voltar do navegador).
3. Se o lead ainda não tiver nenhuma conversa registrada, mostrar a lista com um aviso curto ("Esse lead ainda não tem conversas") em vez de tela vazia sem explicação.

## Detalhes técnicos

- `src/pages/Conversations.tsx`: usar `useSearchParams` do react-router; efeito que faz `setSelectedLeadId(param)` quando `leadGroups` termina de carregar; `setSearchParams` ao selecionar/voltar.
- Nenhuma mudança de backend, dados ou de `LeadProgressDrawer` (o link já está correto).
- Bump de versão em `src/lib/version.ts` para `beta 0.36`.
