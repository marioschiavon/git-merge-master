# WhatsApp (Hook7): diagnóstico e correções

## O que encontrei hoje

Consultei o banco e o código. A ligação com o serviço de WhatsApp funciona, mas há falhas na forma como o sistema reage quando um número cai.

**Situação atual das conexões**

| Empresa | Número | Situação |
|---|---|---|
| Arrecadeei | 5511971902172 | Conectado (último contato hoje, 12/09) |
| Hook7 (interna) | 554195472941 | Conectado |
| Qualé | 5511933371087 | **Desconectado desde 11/09 de madrugada** (o celular deslogou o aparelho) |
| Arrecadeei (conexão antiga) | 5511971902172 | Marcada como "banida" pelo app — **provavelmente rótulo errado**: o mesmo número segue funcionando na conexão nova |

**Problemas confirmados**

1. **Ninguém é avisado quando a conexão cai.** A Qualé está sem WhatsApp há mais de um dia e não houve nenhum aviso no app nem por e-mail.
2. **Mensagem presa em loop.** Existe 1 mensagem na fila da Qualé que já foi tentada **1.282 vezes** desde 11/09, a cada 30 segundos, sempre com "conexão desconectada". Ela nunca desiste e nunca alerta.
3. **A contagem de tentativas está errada.** Cada reagendamento (fora do horário comercial, limite diário atingido, conexão caída) conta como tentativa. Como o limite de desistência é 3, uma mensagem que esperou o horário comercial é descartada no primeiro erro real de envio, em vez de tentar 3 vezes.
4. **Item travado.** Há uma mensagem parada no estado "enviando" desde 23/07 — se a função cai no meio do envio, o item nunca volta para a fila.
5. **A situação só é conferida quando alguém abre a tela.** Não existe rotina automática comparando o que o app mostra com o que o servidor de WhatsApp diz. Por isso uma conexão pode ficar mostrando "Conectado" por horas sem estar.
6. **Rótulo de "banido" sem base suficiente.** Hoje qualquer queda com código 403 vira "banido". No caso da Arrecadeei isso é falso alarme: o mesmo número foi reconectado normalmente e está ativo. Dizer "banido" sem certeza gera desconfiança do cliente.


## O que proponho alterar

1. **Rotina automática de conferência (a cada 5 min):** nova função que pergunta ao servidor o estado real de cada conexão ativa e corrige a situação no app.
2. **Aviso claro de queda:** quando uma conexão cai, mostrar um aviso fixo no topo das telas de Leads/Cadências e em Integrações, com o botão de reconectar — sempre com a mensagem neutra "conexão caiu, leia o QR-Code de novo".
3. **Nunca dizer "banido" por suposição:** o app deixa de rotular como banimento só porque a queda veio com código 403. Tudo vira "desconectado — reconecte". O indício de bloqueio fica guardado internamente e só aparece como suspeita (texto do tipo "o WhatsApp recusou este número mais de uma vez; se não conseguir reconectar, considere outro chip") depois de várias recusas seguidas na mesma conexão, sem afirmar banimento.
4. **Fila para de girar em falso:** limitar a espera por conexão caída (a cada 5 min, e não 30 s) e, depois de 6 horas sem conexão, marcar a mensagem como não enviada com motivo explicado, registrando no histórico do lead.
5. **Separar "tentativas de envio" de "reagendamentos"**, para o limite de 3 valer só para erros reais de envio.
6. **Destravar itens parados:** qualquer item em "enviando" há mais de 10 minutos volta para a fila.
7. **Limpeza dos casos atuais:** encerrar a mensagem presa da Qualé, destravar o item de julho e corrigir a conexão antiga da Arrecadeei — sai de "banida" e é arquivada como substituída, já que o número está ativo na conexão nova.

## Detalhes técnicos

- Nova função `whatsapp-reconcile-cron` usando `connectionState` de `_shared/whatsapp-engine.ts` com o token por instância; agendada via `cron.job` a cada 5 minutos; atualiza `hook7_instances.status`, `last_error` e `last_connected_at`, respeitando `withinUserDisconnectWindow`.
- `whatsapp_send_queue`: nova coluna `send_attempts` (erros reais de envio) mantendo `attempts` como contador geral; `whatsapp-send-tick` passa a usar `send_attempts` contra `MAX_ATTEMPTS`.
- `whatsapp-send-tick`: reagendamento por `instance_disconnected` sobe para 300 s; se `created_at` tiver mais de 6 h e a instância seguir desconectada → `status='failed'` + `lead_activities`; no início do tick, reclaim de linhas `sending` com `updated_at < now() - 10 min`.
- Aviso na interface: hook `useWhatsAppConnectionAlert` lendo `hook7_instances` (status ≠ connected e não arquivada) + banner no `AppLayout`.
- `WhatsAppManagerDialog.tsx`: seção separada para `status='banned'`.
- Versão beta 0.56 e nova entrada em `docs/patch-logs/`.
