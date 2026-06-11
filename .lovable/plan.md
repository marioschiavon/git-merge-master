## Plano

1. **Blindar antes do classificador de intent**
   - Detectar perguntas esclarecedoras logo após limpar a mensagem recebida, antes de chamar `classify-intent` e antes de `routeAndEnqueue`.
   - Assim, mensagens como “Quanto tempo e de reuniao?” não serão registradas/roteadas como `scheduling/event_type_question` nem entrarão no fluxo de disponibilidade.

2. **Normalizar texto para regex robusta**
   - Criar uma normalização simples: lowercase, remoção de acentos e pontuação redundante.
   - Ampliar os padrões para cobrir variações sem acento/erro comum: `quanto tempo e de reuniao`, `tempo de reuniao`, `quanto dura a reuniao`, `duracao`, `demora muito`, etc.

3. **Criar resposta determinística para pergunta esclarecedora**
   - Se for duração: responder diretamente com a duração real do evento quando disponível: “É uma apresentação rápida, em torno de X minutos.”
   - Se a duração não estiver disponível: responder sem inventar número: “É uma apresentação rápida, bem objetiva.”
   - Manter respostas determinísticas para formato, participantes e objetivo.

4. **Adicionar trava final antes do envio**
   - Mesmo se algum guard posterior transformar a ação em `schedule` ou `check_availability`, revalidar a última mensagem antes de enviar.
   - Se for pergunta esclarecedora e não houver data/hora concreta, sobrescrever para `reply` e impedir o fallback “Poderia me dizer o dia e horário exato...”.

5. **Adicionar logs claros de diagnóstico**
   - Logar quando a pergunta esclarecedora for detectada cedo e quando a trava final impedir roteamento de agenda.
   - Isso facilita confirmar no próximo teste que o fluxo correto foi usado.

## Detalhes técnicos

- Arquivo principal: `supabase/functions/inbound-webhook/index.ts`.
- Não haverá alteração de UI nem banco de dados.
- A correção será determinística, não dependente da IA, porque o problema atual ocorre quando a IA/classificador ainda enxerga “reunião” e empurra para agendamento.