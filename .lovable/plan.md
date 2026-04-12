

## Corrigir processamento de respostas de email

### Problema
A mensagem "Tudo bem? Como funciona isso?" não foi respondida porque:
1. O email chegou com todo o texto citado do Gmail (quoted text), confundindo a IA
2. A IA classificou como `confirm_slot` erroneamente
3. Não havia slots `held` disponíveis (já processados), então `reply_message` ficou null
4. Nenhuma resposta foi enviada

### Mudanças

**1. `inbound-email-webhook/index.ts` — Limpar texto citado**

Adicionar função `stripQuotedText()` que remove o texto citado antes de enviar ao `inbound-webhook`:
- Detectar padrão Gmail: `Em ... escreveu:` seguido de linhas com `>`
- Detectar padrão Outlook: `-----Original Message-----` ou `From: ... Sent: ...`
- Detectar padrão genérico: `On ... wrote:`
- Manter apenas o texto novo do prospect

**2. `inbound-webhook/index.ts` — Fallback para confirm_slot sem slots**

Na linha 246, quando `parsed.action === "confirm_slot"` mas `heldSlots.length < 2`:
- Reclassificar automaticamente como `action = "reply"`
- Chamar a IA novamente OU gerar uma resposta genérica baseada no sentimento
- Garantir que `reply_message` nunca fique null para action="reply"

Adicionar no fallback do JSON parse (linha 242): se action="reply" e reply_message é null, gerar resposta padrão.

### Escopo
- 2 edge functions atualizadas
- Nenhuma mudança de banco ou UI

