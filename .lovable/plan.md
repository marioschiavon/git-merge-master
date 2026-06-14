# Bug: "não seria comigo" virou not_interested em vez de referral

## Diagnóstico (com base no run real)

O Juliano respondeu: **"Muito legal, mas esse assunto não seria comigo."**

O classificador rotulou como `not_interested` (confidence alta), então a Policy caiu no branch `closed_lost` e o LLM apenas se despediu cordialmente — **sem perguntar quem seria a pessoa certa, sem pedir nome/contato, sem oferecer mencionar a indicação**.

`final_output.rationale` do último run confirma:
> "O lead informou que não é a pessoa certa para o assunto, o que interpreto como uma forma de declinar... A política é `closed_lost`."

Sinais como *"não sou eu / não é comigo / não seria comigo / quem cuida disso é o(a)…"* devem ser tratados como **referral implícito** (lead redireciona, não recusa), abrindo espaço para perguntar contato.

## Mudanças

### 1. `supabase/functions/_shared/intent-classifier.ts`
- Atualizar o `SYSTEM_PROMPT`:
  - Em **referral**, listar explicitamente o caso "não sou eu para este assunto / não é comigo / não seria comigo / quem cuida disso é outra pessoa / fala com X" — mesmo SEM contato ainda. Isso é referral (precisamos pedir contato), NÃO not_interested.
  - Em **not_interested**, deixar claro que exige recusa do PRODUTO ("não tenho interesse", "para de me mandar", "não quero", "não precisamos"), não apenas redirecionamento de interlocutor.
- Adicionar **regra determinística pré-LLM**: se o inbound bater regex `/(n[aã]o\s+(?:sou\s+eu|seria\s+comigo|[ée]\s+comigo|sou\s+(?:o|a)\s+respons[aá]vel)|quem\s+(?:cuida|v[eê]|trata)\s+(?:disso|desse\s+assunto)|fal[ae]\s+com\s+\w+|procura\s+(?:o|a)\s+\w+)/i` → retornar `intent: "referral"`, `confidence: 0.9` sem chamar LLM. Mais barato e elimina o erro observado.

### 2. `supabase/functions/_shared/policy-engine.ts`
- No branch `case "referral"`, subdividir o caminho "sem contato":
  - **Sem contato E sem nome detectados** (caso "não seria comigo" puro): `response_directive` passa a ser
    > "O lead sinalizou que NÃO é a pessoa certa para esse assunto, mas ainda não indicou quem é. Responda de forma curta e cordial reconhecendo, e pergunte quem seria a pessoa correta (nome/cargo) e o melhor contato (email ou WhatsApp). Pergunte também se você pode mencionar que falou com ele. NÃO se despeça nem encerre o contato — estamos buscando o decisor. NÃO ofereça reunião."
  - **Com nome mas sem email/telefone**: pedir apenas o contato + permissão.
  - Continuar com `post_actions: ["release_slot_holds"]` (lead atual não vai agendar).
- Manter `reason` distintos: `referral_redirect_no_contact`, `referral_named_no_contact`, `referral_with_contact`.

### 3. `supabase/functions/_shared/entity-extractor.ts`
- Adicionar flag `redirect_signal: boolean` em `ReferralContact` quando o regex de "não sou eu / não é comigo" disparar, para a Policy distinguir referral implícito de explícito mesmo sem nome.

### 4. Testes
- `intent-classifier_test.ts` (criar se não existir): cobrir "não seria comigo", "não sou eu, fala com a Marina", "quem cuida disso é o financeiro" → todos `referral`, todos via fast-path determinístico (sem chamar AI gateway).
- `policy-engine_test.ts`: adicionar caso referral com `redirect_signal=true` e sem contato → `forced_tool=null`, diretiva contém "quem seria a pessoa correta", `post_actions` inclui `release_slot_holds`.
- `entity-extractor_test.ts`: caso "não seria comigo" → `referral_contact.redirect_signal=true`, sem email/phone/name.

### 5. Verificação
- `supabase--test_edge_functions` nos shared tests.
- Deploy de `sdr-agent`. Não há mudança de schema.

## Fora de escopo
- Não mexer em cadência/follow-up automático para leads marcados como "wrong person" — fica para iteração futura (hoje o release_slot_holds + ausência de booking já evita mensagens órfãs; o lead atual permanece em fluxo padrão até alguém marcar como `not_interested` real).
- Não criar novo intent `wrong_person` — reusar `referral` evita refatorar a Policy.
