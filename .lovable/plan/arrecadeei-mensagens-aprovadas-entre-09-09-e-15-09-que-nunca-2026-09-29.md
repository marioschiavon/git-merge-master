# Arrecadeei: mensagens aprovadas entre 09/09 e 15/09 que nunca foram enviadas

## O que aconteceu (confirmado nos dados)

- As aprovações **não sumiram**. Entre 09/09 e 15/09 a Bruna aprovou **36 mensagens** (4 em 09/09, 10 em 10/09, 22 em 15/09). Todas continuam registradas como "aprovadas".
- **Nenhuma delas saiu.** Não existe mensagem enviada, nem item na fila do WhatsApp, para esses leads depois da aprovação. A última mensagem de WhatsApp realmente enviada foi em 08/09, às 18h50. Ou seja, o WhatsApp não perdeu nada: essas mensagens nunca chegaram a ser enviadas.
- **Causa:** essas mensagens foram geradas em 25/08 e 07/09 e ficaram dias esperando aprovação. A cadência tem um prazo máximo de 15 dias. Quando a Bruna aprovou, o app reativou o lead na cadência, e o agente viu que o prazo já tinha passado e encerrou o lead ("Passou do prazo de 15 dias"). Isso aconteceu nas 36 aprovações.
- **Por que ninguém percebeu:** depois de aprovar, o app marcava a aprovação como enviada sem conferir se o envio aconteceu. A mensagem sai da tela de Aprovações, mas não aparece na conversa. Por isso parece que ela "sumiu".
- O bloqueio do WhatsApp em 16/09 não teve relação com isso, porque essas mensagens nem foram disparadas.

## O que vou corrigir

1. **Uma mensagem aprovada por uma pessoa sempre é enviada.** O prazo da cadência continua valendo para mensagens novas criadas pela IA. Mas ele não cancela uma mensagem que uma pessoa já aprovou.
2. **A aprovação só aparece como enviada depois do envio.** Se não for possível enviar (prazo, lead protegido, sem WhatsApp, lead já encerrado), a aprovação fica como **Falhou**, mostra o motivo e fica anotada no histórico do lead.
3. **Aviso de aprovação antiga.** Na tela Aprovações, itens com mais de 7 dias ganham o selo "Antiga". Assim a pessoa revisa se ainda faz sentido enviar, porque o contexto pode ter mudado.
4. **Aprovações de 28–29/09:** vou conferir se aconteceu o mesmo nas aprovações recentes da Arrecadeei. Se aconteceu, entram na recuperação abaixo.

## Recuperação das 36 mensagens

Elas não serão reenviadas automaticamente, porque o conteúdo tem quase um mês e o número ficou bloqueado. Vou devolvê-las para **Aprovações** como pendentes, com o selo "Antiga". Assim a Bruna decide uma a uma o que ainda vale enviar, respeitando o ritmo de envio contra spam.

Também vou registrar a correção nas notas da versão (beta 0.65) e no manual de Aprovações.

## Detalhes técnicos

- `approval-execute`: o ramo agêntico hoje chama `cadence-agent-decide` sem verificar o resultado. Ele passa a ler a resposta e só marca `approved`/`edited_sent` quando a mensagem é enviada ou colocada na fila. Nos outros casos marca `failed` com `execution_error` e grava em `lead_activities`. O mesmo vale para o ramo de etapas (`cadence-executor`).
- `cadence-agent-decide`: quando recebe `bypass_hitl` + `override_decision` de aprovação humana, pula as paradas antecipadas `max_days`/`max_attempts` (as de opt-out e proteção continuam valendo) e grava a decisão com o motivo "aprovado por humano".
- Dados: voltar as 36 `approval_requests` (Arrecadeei, reviewed_at entre 09/09 e 16/09, sem envio) para `pending`, com `context.recovered=true`. Os enrollments continuam `completed` até a nova aprovação.
- UI `Approvals.tsx`: selo "Antiga" quando `created_at` passar de 7 dias.
- Redeploy de `approval-execute` e `cadence-agent-decide`. Verificação por consulta: nova aprovação → mensagem na fila → mensagem na conversa.
