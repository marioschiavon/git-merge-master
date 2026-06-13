## Diagnóstico

Na conversa `217275fa…`:

- 14:20 e 14:21 o SDR mandou **3 horários** (`15/jun 09:00`, `09:45`, `17:00`) — viola a regra "máximo 2 por turno".
- `slot_holds` desse turno tem só **2 holds reais** e nenhum é 15/jun — são `01/jul 09:00` e `03/jul 09:45`. Ou seja, a mensagem texto do LLM **alucinou** datas que não foram reservadas (por isso "não tem slot reservado para a 3ª sugestão").
- Lead respondeu **"Terceira"**. `matchesSlotReference` não tem padrões ordinais ("primeira/segunda/terceira"), então não casou → SDR reofereceu a mesma lista de 3.

## Correções em `supabase/functions/sdr-agent/index.ts`

### 1. Hard-cap de 2 slots no ramo `offer_slots`

Antes de persistir `offered_slots_pending` e enviar mensagem:

```ts
let offered = (Array.isArray(fd.offered_slots) ? fd.offered_slots : [])
  .filter((s) => typeof s === "string" && s.length > 0);
if (offered.length > 2) offered = offered.slice(0, 2);
```

### 2. Validar `offered` contra holds reais

Buscar `slot_holds` ativos (`status='held'`, `expires_at > now()`) do lead e **descartar** qualquer ISO em `offered` que não tenha hold correspondente (tolerância de 60s). Isso elimina datas alucinadas pelo LLM.

Se sobrar 0 ISOs validados → liveResult `ok:false` com motivo `no_valid_holds` (não envia mensagem ao lead).

### 3. Reescrever a mensagem quando divergir dos ISOs validados

Após validar `offered`, contar bullets/datas no `msg`. Se o número de linhas com `•`/`📅` no texto for maior que `offered.length`, ou se o texto mencionar dia/hora que não está em nenhum dos ISOs validados (usando `_slotPatterns`), **substituir** `msg` por uma versão formatada a partir de `offered` (mantendo um preâmbulo curto se houver). Isso garante que o que o lead vê = o que está reservado.

### 4. Aceitar ordinais em `matchesSlotReference`

Adicionar resolução posicional ANTES do scoring por dia/hora:

```ts
const ORDINAL_MAP: Record<string, number> = {
  "primeira": 0, "primeiro": 0, "1a": 0, "1o": 0, "1º": 0, "1ª": 0, "opcao 1": 0, "opção 1": 0,
  "segunda": 1, "segundo": 1, "2a": 1, "2o": 1, "2º": 1, "2ª": 1, "opcao 2": 1, "opção 2": 1,
  "terceira": 2, "terceiro": 2, "3a": 2, "3o": 2, "3º": 2, "3ª": 2, "opcao 3": 2, "opção 3": 2,
  "ultima": -1, "último": -1, "ultimo": -1,
};
```

Para cada chave normalizada presente no texto (com word-boundaries para não pegar "segunda-feira" como ordinal — exigir que NÃO seja seguido de "-feira"/"feira"), retornar o ISO em `candidateIsos[idx]`. Se múltiplos ordinais conflitarem → `ambiguous:true`.

Cuidado especial: a palavra **"segunda"** é dia da semana em pt-BR. Só tratar como ordinal se NÃO vier seguida de "feira" (com ou sem hífen) e se NÃO houver outra menção de dia da semana.

### 5. Reforço no system prompt

Adicionar regra explícita: "Quando você ofereceu N horários, o lead pode responder com ordinais ('primeira', 'segunda opção', 'terceira', 'a 1ª', 'a última') — isso É confirmação. Emita `book_slot`/`reschedule_booking` com o ISO da posição correspondente da sua oferta anterior. Nunca reofereça a mesma lista nesse caso."

Reafirmar: "Você JAMAIS pode listar no texto da mensagem horários que não estão em `offered_slots`. O texto e o array devem coincidir 1:1."

## Arquivos a alterar

- `supabase/functions/sdr-agent/index.ts` (helper `matchesSlotReference`, ramo `offer_slots`, system prompt)

## Fora de escopo

- Mudanças em `calcom-slots`, `execute-action`, UI ou debounce.
- Mexer na lógica de quantos slots o `check_calendar` pré-reserva (já é 2).

## Validação

Após deploy, simular via `curl_edge_functions`:

1. Lead recebe oferta de 2 slots (`A`, `B`) e responde **"segunda opção"** → esperar `liveResult.action="book_slot"` com `slot_start=B` e booking criado.
2. Lead recebe oferta de 3 slots (forçada via prompt) → confirmar que o agente só envia 2 no texto e só 2 ficam em `offered_slots_pending`.
3. Lead responde **"terceira"** quando só há 2 opções → resposta deve pedir clarificação (não fazer book_slot e não reofertar lista inteira).
