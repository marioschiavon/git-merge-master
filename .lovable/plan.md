# Por que está enviando 2x

Confirmei no banco para o lead Nico (enrollment `25067329…`):

- 1 único enrollment, mas **2 mensagens outbound** do step 1 com `auto_generated:true`, enviadas com **2,4 s de diferença** (22:15:00.476 e 22:15:03.010).
- 2 `execution_logs` para o mesmo `step_id`, mesmo intervalo.

Causa: **race condition no `cadence-executor`**. A função:

1. Faz `SELECT … WHERE status='active' AND next_execution_at <= now()`.
2. Gera mensagem com IA (demora ~2-3 s).
3. Só **depois** faz o `UPDATE` avançando `current_step` e `next_execution_at`.

Se o cron (ou um disparo manual) invoca a função duas vezes em paralelo — ou se a mesma invocação chega via 2 caminhos — ambas as execuções leem o enrollment no estado original, geram mensagem, e ambas enviam. O `UPDATE` final acontece nas duas, mas o estrago já foi feito (2 e-mails, 2 messages, 2 execution_logs).

Não há `SELECT … FOR UPDATE`, nem flag `executing`, nem claim atômico — então qualquer sobreposição duplica.

# Correção proposta

**Claim atômico do enrollment antes de processar**, em `supabase/functions/cadence-executor/index.ts`.

Trocar o fluxo "select N → for each → processar → update" por:

1. `SELECT id FROM cadence_enrollments WHERE status='active' AND meeting_scheduled=false AND next_execution_at <= now() LIMIT N` (apenas ids candidatos).
2. Para cada id, fazer um **update condicional atômico** que serve de lock:
   ```sql
   UPDATE cadence_enrollments
     SET next_execution_at = next_execution_at + interval '10 minutes' -- placeholder de lock
     WHERE id = $1
       AND status = 'active'
       AND next_execution_at <= now()
     RETURNING *, leads(...), cadences(...)
   ```
   Se o `RETURNING` vier vazio, **outra execução já pegou esse enrollment** → pular silenciosamente.
3. Se veio resultado, processar normalmente (gerar mensagem, enviar, log).
4. No final, o `UPDATE` existente que avança `current_step` / define `next_execution_at` real continua igual — sobrescreve o placeholder do lock.
5. Se der erro no meio, o placeholder garante que o enrollment só será re-tentado daqui a 10 min (em vez de imediatamente em loop).

Mesma correção aplicada ao loop que usa `cadence_custom_messages` (mesmo arquivo, mesmo problema).

## Por que essa abordagem

- Não exige nova coluna nem migração.
- `UPDATE … WHERE next_execution_at <= now() RETURNING` é atômico no Postgres — apenas um worker ganha.
- Resolve tanto cron sobreposto quanto qualquer reinvocação acidental.
- Mantém o comportamento de retry: se falhar antes do update final, volta a ficar elegível em 10 min.

## Arquivos afetados

- `supabase/functions/cadence-executor/index.ts` — substituir o select+loop pelo padrão claim-then-process nos dois ramos (custom message e IA).

Nenhuma alteração de schema, de RLS, ou de outras edge functions.
