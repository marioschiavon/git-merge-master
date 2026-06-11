## Contexto

Na conversa da Juju2, o prospect disse "Posso confirmar mais tarde?" e o SDR respondeu:

> "Claro, sem problema. Prefere que eu te relembre mais tarde ou amanhã? Assim que puder, me avisa e eu já agendo por aqui."

**O sistema NÃO suporta esse tipo de lembrete ativo.** O `inbound-webhook` só age quando há mensagem nova do prospect. Não existe job que dispare follow-up "amanhã" ou "mais tarde" por iniciativa do SDR fora das cadências configuradas (que são pré-definidas no onboarding, não acionáveis pela IA durante a conversa). Promessa = alucinação.

## Mudança

Editar o prompt do SDR em `supabase/functions/inbound-webhook/index.ts` (bloco `REGRAS`, ~linha 622) para proibir explicitamente esse tipo de promessa.

### Nova regra a adicionar

```
- NUNCA prometa lembretes, follow-ups ativos ou retornos por iniciativa do SDR ("eu te lembro amanhã", "te aviso mais tarde", "volto a falar em X horas", "te chamo depois"). O sistema só responde quando o prospect manda nova mensagem. Se o prospect pedir tempo ("posso confirmar mais tarde", "te respondo depois", "deixa eu ver minha agenda"), responda de forma passiva: agradeça, diga que fica no aguardo, e peça que ele avise quando puder. Exemplo: "Sem problema, fico no aguardo. Quando puder, me avisa o melhor horário pra você."
```

## Validação

Reenviar (mental ou via curl) "Posso confirmar mais tarde?" → resposta esperada não deve conter "eu te lembro", "te aviso amanhã/mais tarde", "volto a falar". Deve ser passiva ("fico no aguardo, me avisa quando puder").

## Fora de escopo

- Implementar lembretes reais agendados (seria feature nova, requer discussão).
- Mexer em cadências existentes.
- UI de `/conversations`.
