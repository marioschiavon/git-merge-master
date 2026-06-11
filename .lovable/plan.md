## Plano

1. **Corrigir o detector de pergunta esclarecedora**
   - Ajustar a normalização para remover acentos sem perder o sentido.
   - Corrigir o regex de duração para capturar exatamente mensagens como `Quanto tempo e de reuniao?`, `quanto tempo é a reunião?`, `quanto tempo dura a call?`.
   - Incluir variações comuns: `tempo de reuniao`, `tempo da reuniao`, `quanto tempo vai durar`, `é rápido?`.

2. **Mover a resposta para um short-circuit real**
   - Hoje a detecção acontece, mas o fluxo continua até a IA e os guards de agenda.
   - Vou retornar a resposta diretamente logo após carregar o contexto mínimo e a duração da reunião, antes de classificador, prompt da IA e regras de agendamento.
   - Isso impede completamente que a pergunta caia em `scheduling`, `check_availability` ou no fallback pedindo dia/horário.

3. **Evitar side effects indevidos**
   - Garantir que perguntas sobre duração/formato/participantes/objetivo não disparem `routeAndEnqueue` nem alterem o estado de agendamento.
   - Manter o histórico da conversa e atividades normalmente, mas sem mexer em slots, holds ou cadência de reunião.

4. **Adicionar logs de prova**
   - Logar a mensagem normalizada, o tipo detectado e o fato de que o short-circuit respondeu diretamente.
   - Assim, se acontecer novamente, os logs mostram se a versão nova rodou e qual rota foi tomada.

5. **Validar com teste local de lógica**
   - Conferir que `Quanto tempo e de reuniao?` retorna `duration`.
   - Conferir que frases com data/hora real continuam seguindo para agenda.
   - Conferir que perguntas sobre formato, participantes e objetivo continuam respondendo diretamente.

## Arquivo afetado

- `supabase/functions/inbound-webhook/index.ts`

## Observação técnica

Os logs atuais mostram que a versão executada ainda passou por `intent routed: scheduling event_type_question` e depois caiu em `check_availability but no datetime...`. Então a correção precisa sair do modelo de “guard posterior” e virar um retorno antecipado determinístico antes de qualquer roteamento de agenda.