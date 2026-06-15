# Problema

No último turno do lead Juliano (`Quero agendar`), o SDR respondeu:

> *"Que ótimo, Juliano. Tenho estes dois horários disponíveis, qual deles funciona para você?"*

…sem listar os horários. O `check_calendar` rodou normal, retornou 2 holds (17/06 09:45 e 19/06 16:00), e o LLM chamou `finalize({ decision: "offer_slots", offered_slots: [...] })` com os ISOs corretos no array — mas o **texto** que ele escreveu não menciona nenhum horário.

## Causa raiz

Em `supabase/functions/sdr-agent/index.ts`, no handler de `offer_slots` (linhas 1971-1988), o guard `needRewrite` só dispara a reescrita automática quando o texto contém marcadores de bullet (`•`, `📅`, `-`, `*`):

```ts
const bulletCount = (msg.match(/(^|\n)\s*(•|📅|[-*])\s+/g) || []).length;
let needRewrite = !msg || bulletCount > offered.length;
if (!needRewrite && bulletCount > 0) {
  // valida se cada slot aparece no texto
}
```

Quando o LLM escreve uma frase corrida sem bullets (caso atual), `bulletCount = 0`, então o ramo de validação dia+hora nunca executa e a mensagem genérica é enviada como está.

## Mudança

### `supabase/functions/sdr-agent/index.ts` — handler `offer_slots` (~linha 1971)

Substituir a lógica de `needRewrite` para **sempre** verificar que cada ISO em `offered` aparece no texto (dia + hora), independente de ter bullets:

```ts
let needRewrite = !msg;
if (!needRewrite) {
  const tNorm = ` ${_normalizeText(msg)} `;
  const allMatched = offered.every((iso) => {
    const { day, hour } = _slotPatterns(iso);
    const dayHit = day.some((p) => tNorm.includes(_normalizeText(p)));
    const hourHit = hour.some((p) => tNorm.includes(_normalizeText(p)));
    return dayHit && hourHit;
  });
  if (!allMatched) needRewrite = true;
  // segurança extra: bullets demais
  const bulletCount = (msg.match(/(^|\n)\s*(•|📅|[-*])\s+/g) || []).length;
  if (bulletCount > offered.length) needRewrite = true;
}
```

Assim, qualquer mensagem que não cite explicitamente o dia + hora de cada slot oferecido é reescrita para o template padrão:

```
Tenho estas opções disponíveis:

📅 quarta-feira, 17 de junho às 09:45
📅 sexta-feira, 19 de junho às 16:00

Qual funciona melhor pra você?
```

### Deploy
`sdr-agent`.

## Por que é seguro
- A reescrita já é o fallback padrão e está testada no fluxo (já roda quando há bullets divergentes).
- Mensagens corretas (que mencionam dia + hora de cada slot) passam intactas.
- Não muda nenhum outro caminho do agente.

## Backfill manual
Reenviar manualmente os horários ao Juliano via Conversas (ou esperar a próxima resposta dele, mas a UX já está quebrada nesse turno).
