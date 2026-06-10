Diagnóstico confirmado nos dados do lead “Ju Ca”:

- A tela mostra duplicado porque o email está sendo salvo duas vezes no histórico: uma vez dentro da função de envio de Gmail e outra vez no `cadence-executor` logo depois.
- Além disso, esse lead está ativo em duas cadências diferentes ao mesmo tempo (`Cadencia 01` e `Cadencia 02`), então ele recebeu/gerou dois primeiros contatos diferentes em sequência.
- O bloqueio anterior resolveu a corrida entre execuções concorrentes da mesma cadência, mas não atacava esses dois pontos.

Plano de correção:

1. Corrigir o histórico duplicado de email
   - Ajustar `cadence-executor` para não inserir uma segunda mensagem em `messages` quando o canal for email e o `gmail-send` já salvou a mensagem enviada.
   - Passar o `conversation_id` correto para `gmail-send`, para a mensagem real enviada ficar vinculada à conversa/cadência certa.
   - Manter o registro em `execution_logs` e `lead_activities`, sem duplicar o balão na conversa.

2. Preservar metadados da cadência no email salvo
   - Atualizar `gmail-send` para aceitar metadados opcionais como `step_order`, `subject`, `custom_message`, `auto_generated` e `channel`.
   - Assim a mensagem única exibida no histórico continua tendo contexto suficiente para a interface e auditoria.

3. Evitar múltiplas cadências ativas para o mesmo lead
   - Adicionar uma trava no executor: antes de enviar step 1, se o lead já tiver outro enrollment ativo que já executou primeiro contato recentemente, não enviar outro primeiro contato em paralelo.
   - Marcar/pausar o enrollment duplicado com motivo claro em `paused_reason`, em vez de mandar outra abordagem.

4. Limpeza dos duplicados atuais do lead Ju Ca
   - Remover do histórico apenas os registros duplicados internos gerados pelo app, preservando a mensagem real enviada via Gmail.
   - Manter logs de execução para auditoria.

Arquivos previstos:

- `supabase/functions/cadence-executor/index.ts`
- `supabase/functions/gmail-send/index.ts`

Validação:

- Reconsultar mensagens do lead Ju Ca e confirmar que cada email enviado aparece uma única vez na conversa.
- Confirmar que cadências paralelas não disparam dois primeiros contatos para o mesmo lead.