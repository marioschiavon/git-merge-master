## Problema

Na conversa: agente ofereceu `1/jul 09:00` e `3/jul 09:45`. Lead respondeu **"Dia 1"**. O agente:
1. Bloqueou o `book_slot` porque "Dia 1" não bate com `CONFIRMATION_REGEX`.
2. No downgrade, listou **slots antigos (15/jun)** vindos de `slot_holds` ainda com `status='held'` de turnos anteriores, em vez dos slots de julho recém-oferecidos.

## Correções no `supabase/functions/sdr-agent/index.ts`

### 1. Aceitar seleção por referência (não só por palavras de confirmação)

Hoje o guard exige `CONFIRMATION_REGEX.test(inbound) === true`. Vamos trocar por:

```
hasConfirmation = CONFIRMATION_REGEX.test(inbound) || matchesSlotReference(inbound, candidates)
```

Nova função `matchesSlotReference(text, candidateIsos)`:

- Para cada ISO candidato, derivar variantes em pt-BR no fuso `America/Sao_Paulo`:
  - dia do mês: `"1"`, `"01"`, `"dia 1"`, `"dia 01"`, `"1/7"`, `"01/07"`, `"1 de julho"`, `"1º"`, `"primeiro"`
  - hora: `"09:00"`, `"9h"`, `"9:00"`, `"as 9"`, `"às 9"`, `"9 da manha"`
  - ordinal pela ordem oferecida: `"primeira"`, `"segunda"`, `"a 1"`, `"opção 1"`, `"opcao 2"`
- Casa se o texto normalizado (lowercase, sem acento) contiver pelo menos uma variante de dia OU de hora correspondente a UM ÚNICO candidato (sem ambiguidade entre as opções oferecidas).
- Retornar `{ matched: true, isoSelected }` para reaproveitar como `slot_start` quando o LLM não preencheu corretamente.

Quando `matchesSlotReference` resolver para um ISO específico, **forçar** `slot_start = isoSelected` antes de prosseguir com o booking (evita o LLM errar a data).

### 2. Downgrade usar SÓ a oferta vigente

Trocar a fonte de `candidates` no bloco de downgrade:

- Preferir `facts.offered_slots_pending.slots` quando existir e for recente (`offered_at` < 30 min).
- Só cair em `heldSlots` se não houver `offered_slots_pending`.
- Nunca misturar os dois.

E a mensagem de downgrade deve ser específica quando houver match parcial:

- Se `matchesSlotReference` casou com um único slot mas faltou confirmação textual → "Só confirmando: você quer fechar **quarta-feira, 1 de julho às 09:00**? Posso agendar?"
- Se nenhum match → manter lista das 2 opções da oferta vigente.

### 3. Limpar `offered_slots_pending` após booking confirmado

No ramo de sucesso (`calcom-confirm-booking` ok), apagar `facts.offered_slots_pending` para não poluir o próximo turno.

### 4. Liberar holds obsoletos ao oferecer novos slots

No ramo `offer_slots` (linha 884), antes de gravar `offered_slots_pending`, marcar `slot_holds` antigos do mesmo lead que NÃO estejam nos novos `offered` como `status='released'`. Isso evita que `heldSlots` em turnos futuros contenha lixo.

### 5. Reforço no system prompt

Adicionar regra explícita: quando o lead responder com referência curta a um slot já oferecido ("dia 1", "o primeiro", "9h", "esse"), **interpretar como confirmação** e emitir `book_slot` com o ISO correto da oferta vigente — não re-perguntar.

## Arquivos a alterar

- `supabase/functions/sdr-agent/index.ts` (regex + helper + guard + downgrade + cleanup + prompt)

## Fora de escopo

- Mudanças no `execute-action`, `calcom-*`, debounce ou UI.
- Política de quantos slots oferecer (já tratado antes).

## Validação

Após deploy, simular via `curl_edge_functions` o cenário: lead diz "Dia 1" depois de oferta `1/jul 09:00` + `3/jul 09:45` → esperar `liveResult.action="book_slot"` com `ok:true` e booking criado para 1/jul 09:00.
