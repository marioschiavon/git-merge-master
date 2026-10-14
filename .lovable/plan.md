# Gmail no lugar certo: card próprio em Integrações e sem menção ao Nylas

## O que muda para o usuário

1. **Novo card "Gmail" em Configurações → Integrações**, categoria Email.
   - Botão **Conectar Gmail** abre a janela do Google na própria tela de Integrações (não precisa ir para outra página).
   - Status no card:
     - Verde "Conectado": mostra o endereço conectado (ex.: joao@empresa.com).
     - Amarelo "Renovar acesso": quando o Google expirou a autorização; o botão vira **Reconectar Gmail**.
     - Cinza "Não conectado".
   - Com a conta conectada: botão **Desconectar**.
   - Mostra também quantas caixas Gmail da equipe estão conectadas (ex.: "2 caixas da equipe").

2. **O card atual "Email" (domínio próprio) vira "Domínio próprio (opcional)"**, com descrição deixando claro que é opcional/legado. Ele continua levando para a página de detalhes.

3. **Página Configurações → Email**:
   - Remover "Nylas é o canal principal" e "via Nylas". O texto passa a ser: **"Gmail é o canal principal: envio e recebimento"**, conectado direto com o Google.
   - O botão "Conectar Gmail" continua ali como atalho, usando o mesmo fluxo.
   - Os botões **Outlook** e **IMAP** ficam escondidos por enquanto, porque ainda dependem do canal antigo. Eles voltam quando houver conexão direta com a Microsoft.
   - O aviso de recebimento fica honesto: a leitura automática das respostas no Gmail é a próxima etapa.

4. **Manual e notas de versão**: atualizar `03-integracoes.md` (adicionar a linha Gmail e marcar o domínio próprio como opcional) e o patch log da beta 0.81.

## Detalhes técnicos

- Extrair o fluxo de popup e as consultas (`connectGmail`, lista de `user_email_grants` com `transport='gmail'`, desconectar) para um hook `src/hooks/useGmailConnection.ts`, reaproveitado pelo card de Integrações e pelo `PersonalEmailCard`.
- Integrations.tsx: adicionar o provider `gmail` ao array `providers`, com o status calculado a partir da conta do usuário atual: `active` → conectado; `expired` ou `error` → pendente, com o rótulo "Renovar acesso".
- PersonalEmailCard: esconder os botões Outlook/IMAP e o tratamento dos parâmetros de callback antigos. As contas antigas já conectadas, se existirem, continuam listadas com a etiqueta "Legado".
- Sem mudança no banco nem no envio; as funções já foram publicadas na etapa anterior.
