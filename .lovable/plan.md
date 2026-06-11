## Problema

Quando o lead disse "Quero desmarcar.", o SDR respondeu passivamente:
> "Sem problema, Ju — cancelo a reunião. Se quiser remarcar, me avisa um dia e horário que funcionem melhor pra você."

Isso entrega o controle ao lead. O SDR deveria assumir a iniciativa, cancelar o slot atual e **já oferecer novos horários** — só desistir de vez se o lead deixar claro que perdeu interesse.

## Causa

Em `inbound-webhook/index.ts` o branch `parsed.action === "cancel"` (linhas 1282–1362):
- cancela o booking,
- marca a cadência como `status: "cancelled"`,
- responde com mensagem passiva ("Sem problemas, cancelei nossa reunião...").

O `reschedule` (linhas 1144–1281) já faz tudo o que queremos (cancela + busca novos slots + propõe). Hoje, "desmarcar" sem novo horário cai em `cancel` em vez de `reschedule`.

## Solução

Tratar **cancelamento ambíguo como reagendamento ativo**. Só fazer o "hard cancel" quando o lead explicitar que não tem mais interesse.

### Mudanças em `supabase/functions/inbound-webhook/index.ts`

1. **Detector de "hard cancel"** (novo helper local, perto dos outros regex utilitários):
   ```
   /\b(n[aã]o\s+(quero|tenho|vou)\s+(mais)?\b|sem\s+interesse|perdi\s+(o\s+)?interesse|cancela(r)?\s+de\s+vez|n[aã]o\s+rola|desisto|n[aã]o\s+precisa\s+mais)\b/i
   ```

2. **No branch `parsed.action === "cancel"`**:
   - Calcular `isHardCancel = HARD_CANCEL_REGEX.test(normalizePtText(cleanContent))`.
   - Se **não** for hard cancel:
     - Sobrescrever `parsed.action = "reschedule"` e cair no fluxo existente de reschedule (que cancela booking + busca/propõe novos slots + mantém cadência em `awaiting_slot_confirmation`).
     - Adicionar log `CANCEL_PROMOTED_TO_RESCHEDULE` para visibilidade.
   - Se for hard cancel: manter o fluxo atual (cancelar, encerrar cadência, mensagem de despedida cordial).

3. **Atualizar o prompt do classifier interno** (string em `inbound-webhook/index.ts` ~linha 609) para refletir a nova regra:
   - "cancel": use APENAS quando o prospect deixar claro que não quer mais a reunião nem remarcar (ex.: "não tenho mais interesse", "desisto", "cancela de vez"). Se ele só disser "quero desmarcar/cancelar a reunião" sem indicar perda de interesse → use "reschedule".

4. **Mensagem padrão do hard cancel**: manter a atual, apenas cordial.

### Validação

- Reenviar "Quero desmarcar." no preview: SDR deve cancelar a reunião e **na mesma resposta** propor 2 novos horários (igual ao fluxo de reschedule).
- Reenviar "Não tenho mais interesse, pode cancelar": SDR deve cancelar e responder com despedida cordial, encerrando a cadência.
- Log `CANCEL_PROMOTED_TO_RESCHEDULE` aparece no primeiro caso e não no segundo.

### Resultado esperado

O SDR mantém o controle: ao primeiro sinal de "desmarcar", já reage propondo novos horários. Só libera o lead quando ele explicitamente sinaliza desinteresse.
