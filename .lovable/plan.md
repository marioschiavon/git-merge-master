## Plano

1. **Adicionar uma proteção determinística antes dos fallbacks de agendamento**
   - Em `inbound-webhook`, detectar mensagens do lead que sejam apenas perguntas esclarecedoras sobre a reunião, especialmente duração: “quanto tempo é?”, “quanto dura?”, “vai demorar?”, etc.
   - Quando detectar isso, forçar `action = "reply"` antes da regra que transforma `reply` com a palavra “reunião” em `schedule`.

2. **Responder com a duração real quando perguntarem**
   - Usar a duração já buscada do Cal.com (`meetingMinutes`).
   - Se disponível: responder de forma curta, por exemplo: “É uma reunião rápida, de aproximadamente X minutos.”
   - Se não disponível: responder sem inventar um tempo específico, mantendo “reunião rápida de apresentação”.

3. **Evitar que a palavra “reunião” dispare agendamento indevido**
   - Ajustar o guard atual que vê `reunião/demo/call` e redireciona para `schedule`, para ignorar perguntas esclarecedoras sem dia/horário.
   - Assim, “quanto tempo é de reunião?” não cairá mais em `schedule` → `check_availability` → “qual dia e horário?”.

4. **Manter o restante do fluxo intacto**
   - Não mexer em UI, banco ou regras gerais de slots.
   - Preservar confirmação, rejeição e sugestão de novo horário exatamente como estão.