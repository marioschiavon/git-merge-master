# Ver rapidamente quem respondeu

## O que acontece hoje
A tela Conversas mostra todos os leads contatados, ordenados pela data em que a conversa foi aberta. Ela não mostra quem respondeu nem quando. Por isso o cliente tem que procurar em Runs do Agente ou no Bitrix.

## O que vamos fazer
1. **Filtro "Responderam" em Conversas**, com abas: Todas | Responderam | Sem resposta. Ao lado, um período: Hoje, 7 dias, 30 dias, Tudo.
2. **Contador no topo**: "12 leads responderam nos últimos 7 dias". Ele acompanha o período escolhido.
3. **Ordem pela última resposta**: quem respondeu por último aparece primeiro. Cada linha mostra:
   - selo "Respondeu" com data e hora,
   - um trecho da última mensagem do lead,
   - o canal.
4. **Busca por nome ou empresa** na lista, para não depender de Acompanhamento.
5. **Atalho no Painel**: um card "Respostas recentes" com o número dos últimos 7 dias. Ao clicar, abre Conversas já filtrada em "Responderam".
6. **Acompanhamento**: filtro "Responderam" na tabela da cadência, com o mesmo critério.
7. Atualizar o manual (Conversas e Painel), as notas da versão e passar para a **beta 0.74**.

## Detalhes técnicos
- A data da resposta vem de `conversations.last_inbound_at`, com a última mensagem `direction='inbound'` como reserva. Antes de usar, vou confirmar que esse campo está preenchido para todas as respostas, e não só para o modo humano. Se houver falhas, faço um preenchimento retroativo a partir de `messages`.
- `useConversations`: buscar `last_inbound_at`. A última mensagem de cada lead vem de uma consulta paginada (`fetchAllIn`). O agrupamento por lead passa a usar `lastReplyAt = max(last_inbound_at)`.
- Filtros e período guardados na URL (`?filtro=responderam&periodo=7d`), para o card do Painel levar direto ao resultado.
- Painel: contagem por `count: "exact"` de conversas da empresa com `last_inbound_at >= agora - 7 dias`, somando leads distintos.
- Não muda nada no envio, na IA nem no Bitrix.
