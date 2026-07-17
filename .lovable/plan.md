Criar um documento interno em `docs/boas-praticas-whatsapp.md` com linguagem leve e amigável, educando usuários leigos sobre as boas práticas de envio de mensagens do WhatsApp que foram implementadas no app.

O texto deve explicar, de forma simples, por que as mensagens não saem todas de uma vez e como cada mecanismo protege a conta do cliente contra bloqueios e melhora a entrega:

- **Fila de envio**: as mensagens entram em uma fila e são enviadas uma a uma, em vez de todas ao mesmo tempo.
- **Jitter (aleatoriedade)**: pequenos atrasos variados entre os envios para parecer mais natural.
- **Limite por hora e por dia**: controle de volume (caps) para não extrapolar os limites do WhatsApp.
- **Warm-up**: aumento gradual do volume para contas novas ou que voltaram a enviar depois de um tempo.
- **Horário comercial**: mensagens automáticas só saem em horários adequados.
- **Regra de reengajamento**: se o lead não respondeu a uma mensagem automática, ele não recebe outra mensagem imediata; o sistema agenda um reengajamento de acordo com a cadência configurada.
- **Respostas imediatas**: quando o lead responde, a resposta do agente sai normalmente, sem esperar o cooldown.

O documento também deve incluir uma seção com dicas práticas do que o usuário pode fazer (ex.: evitar colocar muitos leads de uma vez na mesma cadência, configurar intervalos de reengajamento realistas, revisar mensagens antes de aprovar).

Estrutura sugerida:
1. Título e introdução descontraída.
2. "Por que minhas mensagens não saem na hora?"
3. Cada boa prática em uma seção curta com analogia ou exemplo do dia a dia.
4. "O que eu faço como usuário?" — checklist de ações.
5. Resumo rápido em tópicos.

O arquivo será salvo em `docs/boas-praticas-whatsapp.md`.