## Plano

1. **Confirmar a causa real no fluxo implantado**
   - Os logs atuais mostram que a mensagem entrou em `classify-intent` como `scheduling event_type_question` e depois caiu em `check_availability`, sem aparecer nenhum log de `Early clarifying-question` ou `Clarifying short-circuit`.
   - Isso indica que o código atualmente rodando não passou pelo detector novo, ou que outro ponto está classificando antes/fora do short-circuit.

2. **Tornar a proteção compartilhada e impossível de contornar**
   - Criar um helper compartilhado para detectar perguntas esclarecedoras de reunião: duração, formato, participantes, objetivo/local.
   - Usar esse mesmo helper em `inbound-webhook` e também em `classify-intent`.
   - Assim, mesmo que o classificador seja chamado, ele não poderá retornar `scheduling/event_type_question` para frases como `Quanto tempo e de reuniao?`.

3. **Bloquear o roteamento no ponto de origem**
   - Em `inbound-webhook`, antes de chamar `classify-intent` e antes de `routeAndEnqueue`, se a mensagem for pergunta esclarecedora sem data/hora, marcar explicitamente como `reply`.
   - Adicionar log com marcador único, por exemplo `MEETING_CLARIFIER_BYPASS`, contendo texto normalizado, tipo detectado e ação final.

4. **Corrigir o fallback que está sobrescrevendo a resposta**
   - Blindar os guards de agenda (`schedulingInProgress`, `check_availability sem datetime`, etc.) para não rodarem quando a mensagem é uma pergunta esclarecedora.
   - Isso evita a resposta errada: `Poderia me dizer o dia e horário exato...`.

5. **Validar e publicar as funções corretas**
   - Testar localmente os exemplos:
     - `Quanto tempo e de reuniao?` → resposta sobre duração.
     - `Quanto tempo dura a call?` → resposta sobre duração.
     - `É online?` → resposta sobre formato.
     - `terça às 14h` → continua verificando disponibilidade.
   - Implantar as edge functions alteradas para garantir que o preview use a versão corrigida.

## Resultado esperado

A mensagem `Quanto tempo e de reuniao?` deve responder algo como `É uma apresentação rápida, em torno de X minutos.`, sem acionar classificação de agendamento, fila de ações ou pedido de dia/horário.