
## Diagnóstico

O reengajamento **não roda automaticamente** porque não existe cron agendado para a edge function `cadence-reengage-cron`.

- `SELECT * FROM cron.job` mostra apenas `sdr-debounce-tick`.
- Sem logs recentes de `cadence-reengage-cron` (nunca invocada por cron).
- Existe 1 enrollment elegível (`paused/lead_replied`, `reengage_enabled=true`) só aguardando o gatilho.

A lógica interna da função está correta: já usa a última interação (inbound **ou** outbound) como base do silêncio, respeita `reengage_after_days` / `reengage_max_attempts`, e bloqueia se houver `slot_hold` ativo, booking recente (90d) ou `meeting_scheduled=true`.

## Impacto de performance

Nenhum no app. É um job de backend (pg_cron → pg_net → edge function). Varre no máximo 500 enrollments por tick, filtrados por índice em `status`. Comparação: `sdr-debounce-tick` já roda **a cada 15s** sem problema.

## O que fazer

Criar um `cron.schedule` chamando `cadence-reengage-cron` a cada **30 minutos**. Como o SQL contém URL/anon-key específicos do projeto, será executado via `supabase--insert` (não via migration), seguindo a convenção.

```sql
select cron.schedule(
  'cadence-reengage-cron',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/cadence-reengage-cron',
    headers := '{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

## Validação

1. `SELECT jobname, schedule, active FROM cron.job` mostra o job novo ativo.
2. Aguardar 1 tick (≤30min) e conferir logs de `cadence-reengage-cron`.
3. Enrollment `paused/lead_replied` de 15/07 ainda **não** deve reengajar (silêncio < 2 dias) — comportamento esperado.

## Fora de escopo

- Alterar a lógica de silêncio (já cobre o cenário "nós fomos os últimos a falar").
- Mexer nos defaults de `reengage_after_days` / `reengage_max_attempts` das cadências.
