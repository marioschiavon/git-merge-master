# Excluir leads em massa: deixar o botão visível para o cliente

## O que encontramos
- O botão **Excluir** em massa já existe desde o beta 0.68, na barra que aparece ao marcar leads, logo depois de "Descartar".
- O print do cliente mostra só "Descartar". O mais provável é que o app publicado (app.leaderei.com.br) ainda esteja numa versão anterior, porque as mudanças só chegam ao cliente depois de publicar.
- Outro ponto: a barra não quebra linha. Em telas menores, o último botão (Excluir) pode ficar cortado para fora da tela.

## O que vamos fazer
1. Deixar o botão mais claro: o nome passa a ser **"Excluir selecionados"**, em vermelho, com o ícone de lixeira.
2. Fazer a barra quebrar linha em telas menores, para que nenhum botão fique escondido.
3. Conferir na tela, com leads marcados, que o botão aparece e que a confirmação abre com a contagem certa.
4. Subir para o beta 0.73 e atualizar as notas da versão.
5. Pedir para você **publicar**, para que o cliente receba a mudança.

## Detalhes técnicos
- `src/pages/Leads.tsx`: container da barra de seleção `flex flex-wrap gap-2`; botão de exclusão `variant="destructive"` com texto "Excluir selecionados".
- `src/lib/version.ts` → beta 0.73; novo patch log em `docs/patch-logs/`.
- Verificação com Playwright em viewport estreita (~1100px).
