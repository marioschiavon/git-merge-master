## Problema

O lead Juliano está numa cadência em **modo agentic** ("Inteligente"). Cadências agentic **não usam a tabela `cadence_steps`** — o próximo passo é decidido em tempo real pelo `cadence-agent-decide`. O `cadence-reengage-cron` faz uma verificação rígida procurando uma linha em `cadence_steps` com `step_order > current_step`, e como essa tabela está vazia para cadências agentic, o resultado é sempre "Pulado: Cadência não tem próximo step".

Ou seja: a proteção está incorreta para o modo agentic e está bloqueando 100% dos reengajamentos nessas cadências.

## Correção

**Arquivo:** `supabase/functions/cadence-reengage-cron/index.ts`

Tornar a verificação "tem próximo step?" condicional ao modo da cadência:

1. Incluir `mode` no `select` de `cadences!inner(...)`.
2. Pular completamente a query em `cadence_steps` quando `cad.mode === 'agentic'` — confiar que o executor + agent decidirão a próxima ação dinamicamente.
3. Manter a verificação atual para cadências `mode='static'` (ou null/legacy), onde `cadence_steps` é a fonte da verdade.

Nenhuma outra proteção muda (meeting_scheduled, slot_holds, bookings, max_attempts, time gate continuam iguais).

## Resultado esperado

Após a correção, ao clicar em "Testar reengajamento agora" no lead Juliano:
- enrollment vira `status='active'`, `paused_reason=null`, `next_execution_at=now()`, `reengage_attempts=1`
- toast: "Reengajado (1/3) — próximo step em até 5 min"
- `cadence-executor` na próxima rodada chama `cadence-agent-decide` e dispara a próxima mensagem

## Detalhes técnicos

Mudança mínima no loop principal (~5 linhas), por volta da verificação atual `// Verify there's a next step`:

```ts
if (cad.mode !== "agentic") {
  const { data: nextSteps } = await supabase
    .from("cadence_steps")
    .select("id, step_order")
    .eq("cadence_id", e.cadence_id)
    .gt("step_order", e.current_step ?? 0)
    .order("step_order", { ascending: true })
    .limit(1);
  if (!nextSteps || nextSteps.length === 0) {
    stats.skipped_no_step++;
    details.push({ id: e.id, result: "skipped", reason: "no_next_step" });
    continue;
  }
}
```

Nenhuma migração de banco, nenhuma mudança de UI.