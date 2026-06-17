## Causa raiz

Na cadência de indicações (`cadences.kind = 'referral'`), o `cadence-executor` carrega o lead indicante e injeta o `referrer.name` direto no prompt do LLM:

`supabase/functions/cadence-executor/index.ts:386-406`

```ts
referrerName = referrer?.name || "";
...
- ABRA mencionando que ${referrerName || "um contato em comum"} passou o contato 
  (ex.: "Oi {nome}, o ${referrerName || "[indicante]"} me passou seu contato...").
```

Dois problemas combinados:
1. Quando o indicante não tem nome cadastrado, `leads.name` muitas vezes guarda o **placeholder textual** `"Contato sem nome"` (ou similar derivado), então `referrer?.name || ""` **não cai no fallback** — o nome literal "Contato sem nome" é injetado no prompt. O LLM, obediente, escreve "O Contato sem nome me indicou…".
2. Mesmo quando o nome é vazio, o fallback `"[indicante]"` no exemplo do prompt confunde o LLM em alguns casos.

Também: o modo agêntico (`cadence-agent-decide`) **não injeta nenhum contexto de referral** na primeira mensagem — em cadências agênticas `kind='referral'`, o agente nem sabe que foi indicação. Vou consertar isso de quebra (escopo mínimo).

## Correção

### 1. `supabase/functions/cadence-executor/index.ts` — sanitizar nome do indicante

Trocar o bloco de carga e o prompt para:
- Considerar inválido qualquer nome vazio OU que case com placeholders conhecidos (`"Contato sem nome"`, `"Indicação sem nome"`, `"(indicante sem nome)"`, ou que pareça um e-mail/telefone).
- Quando inválido, **não citar nome nenhum** na abertura. Usar a empresa do indicante se houver (`"alguém da <empresa>"`), senão `"um contato em comum"`.
- Trocar o exemplo literal `"o [indicante] me passou…"` por uma **regra clara** ("se houver nome do indicante, mencione; se não houver, use a empresa ou 'um contato em comum' — NUNCA escreva 'sem nome', '[indicante]' ou placeholders").
- Para a substituição em template (`{{referrer_name}}`), usar o mesmo fallback (empresa ou "um contato em comum").

Pseudo-código (mesmo arquivo, ~linha 386):

```ts
const RAW_NAME_BLACKLIST = new Set([
  "contato sem nome", "indicação sem nome",
  "(indicante sem nome)", "lead sem nome",
]);
const looksLikeEmail = (s: string) => /@/.test(s);
const looksLikePhone = (s: string) => /^\+?\d[\d\s().-]{6,}$/.test(s);
const isUsableName = (s?: string | null) => {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  if (RAW_NAME_BLACKLIST.has(t.toLowerCase())) return false;
  if (looksLikeEmail(t) || looksLikePhone(t)) return false;
  return true;
};
const referrerNameClean = isUsableName(referrer?.name) ? referrer!.name : "";
const referrerCompanyClean = (referrer?.company_name || "").trim();
const referrerLabel =
  referrerNameClean
    ? referrerNameClean
    : referrerCompanyClean
      ? `alguém da ${referrerCompanyClean}`
      : "um contato em comum";
```

E reescrever o bloco de regras:

```
=== INDICAÇÃO (PRIORIDADE MÁXIMA) ===
Este lead foi indicado por ${referrerLabel}${referrerCompanyClean && referrerNameClean ? ` (${referrerCompanyClean})` : ""}.
Contexto da indicação: ${ctxTxt || "não detalhado"}
REGRAS OBRIGATÓRIAS:
- Abra reconhecendo a indicação, usando "${referrerLabel}".
- NUNCA escreva "[indicante]", "Contato sem nome", "Indicação sem nome" ou
  qualquer placeholder. Se não tiver nome próprio do indicante, use a empresa
  dele ("alguém da X") ou expressão neutra ("um contato em comum") — escolha
  uma e siga.
- Se houver contexto, cite em 1 frase. Tom quente e direto.
```

Substituições do template ficam:

```ts
.replaceAll("{{referrer_name}}", referrerLabel)
.replaceAll("{{referrer_company}}", referrerCompanyClean)
```

### 2. `supabase/functions/cadence-agent-decide/index.ts` — injetar contexto de referral na 1ª mensagem

No caminho `isFirstAttempt` (que chama `buildFirstMessage`), quando `cadence.kind === 'referral'` (ou `lead.referral_source_lead_id` não-nulo), carregar o indicante com a mesma sanitização acima e passar `referral_hint` para o `buildFirstMessage`.

### 3. `supabase/functions/_shared/build-first-message.ts` — aceitar `referral_hint`

Adicionar parâmetro opcional `referral_hint?: { label: string; context?: string }` e, quando presente, injetar um bloco análogo ao da cadência estática no system prompt (com as mesmas regras anti-placeholder).

### 4. Defesa em camada de envio (cinto + suspensório)

No `cadence-executor` e no `cadence-agent-decide`, antes de gravar a mensagem em `messages`/enviar, fazer um regex de sanidade leve:

```ts
const FORBIDDEN_RE = /\b(contato sem nome|indicação sem nome|\[indicante\])\b/i;
if (FORBIDDEN_RE.test(finalMessage)) {
  finalMessage = finalMessage.replace(FORBIDDEN_RE, referrerLabel);
}
```

Garante que mesmo se o LLM "vazar", não chega ao lead.

## Fora de escopo

- Não muda schema. `leads.name` continua aceitando "Contato sem nome" como valor histórico — só não vaza mais para a mensagem.
- Não muda UI de `/leads` nem de `/approvals` (a aprovação humana continua sendo o último filtro caso HITL esteja ligado).
- Não toca em `sdr-agent` (o problema é só na cadência de outbound para o indicado).
