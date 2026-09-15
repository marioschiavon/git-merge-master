# WhatsApp: novas inconsistências encontradas (verificação de hoje)

## O que está bem

- Envio e recebimento funcionando: 198 mensagens enviadas e 67 recebidas nos últimos 5 dias.
- A fila de envio está limpa: nenhuma mensagem presa nem girando em falso (as correções de 12/09 seguem valendo).
- A conferência automática das conexões roda a cada 5 minutos, sem falhas.
- Nenhuma conexão rotulada como "banida".

## Inconsistências encontradas

**1. A rotina de envio está rodando em dobro**
Existem duas tarefas agendadas iguais (`whatsapp-send-tick` e `whatsapp-send-tick-30s`), as duas disparando a cada minuto, no mesmo segundo. Isso dobra o consumo e cria risco de duas execuções pegarem a mesma mensagem ao mesmo tempo. A segunda tarefa é resto de uma configuração antiga de 30 em 30 segundos.

**2. Conexões abandonadas continuam "vivas" e fazendo barulho**
Quatro conexões (Agência 007, Spina, Clara, Nico) estão desconectadas desde 28/08 e nunca foram arquivadas. Elas são consultadas no servidor a cada 5 minutos sem necessidade e fazem o aviso vermelho de "WhatsApp caiu" aparecer para sempre nessas contas — o que faz o cliente parar de dar atenção ao aviso quando ele é de verdade.

**3. Duas quedas recentes reais, sem ninguém reconectar**
- Qualé (Andrea): caiu em 11/09 e continua fora.
- Leaderei (Renan): conectou hoje 07h07 e caiu às 12h40.
Nos dois casos o motivo é o celular ter deslogado o aparelho. O aviso no app existe, mas ninguém agiu — vale também avisar por e-mail o administrador da empresa.

**4. Resposta ao lead não tem rede de segurança**
As respostas em conversa são enviadas na hora, direto, sem passar pela fila. Se a conexão estiver caída naquele instante, a resposta simplesmente falha: não há nova tentativa e nada é registrado no histórico do lead. Foi exatamente o que aconteceu na Qualé durante os dias desconectada.

## O que proponho corrigir

1. Remover a tarefa agendada duplicada, deixando uma só execução por minuto.
2. Arquivar automaticamente conexões que estejam desconectadas há mais de 7 dias, e arquivar agora as quatro paradas desde 28/08. O aviso no topo passa a mostrar só quedas recentes (últimos 7 dias).
3. Enviar um e-mail ao administrador da empresa quando uma conexão cair e continuar fora por mais de 30 minutos, uma vez por queda (sem repetir).
4. Na resposta ao lead: se o envio direto falhar por conexão fora do ar, registrar a falha no histórico do lead e reenfileirar a mensagem com prioridade alta, para sair assim que o WhatsApp voltar.

## Detalhes técnicos

- `cron.unschedule('whatsapp-send-tick-30s')`; manter apenas o job 4.
- `whatsapp-reconcile-cron`: ao encontrar `status='disconnected'` com `last_connected_at < now() - 7 dias` (ou nulo e `created_at` idem), setar `archived_at=now()`; migração pontual arquivando os 4 registros parados desde 28/08.
- `useWhatsAppConnectionAlert`: filtrar por `updated_at > now() - 7 dias` além de `archived_at is null`.
- Aviso por e-mail: nova coluna `disconnect_notified_at` em `hook7_instances`; `whatsapp-reconcile-cron` dispara `send-transactional-email` quando a queda passar de 30 min e o campo estiver nulo; zerado ao reconectar.
- `execute-action` e `send-outbound-message`: no `catch` do `sendWhatsAppViaZApi`, gravar `lead_activities` com o motivo e chamar `enqueueWhatsAppSend` com `priority: 10` em vez de apenas retornar erro.
- Versão beta 0.57 e nova entrada em `docs/patch-logs/`.
