## Causa raiz

O lead responde → `inbound-webhook` insere uma linha em `pending_inbound_runs` com `status=pending` e `scheduled_at = now + 12s` (debounce). Uma função cron (`sdr-debounce-tick`) deveria varrer essa tabela a cada ~10s, "reclamar" a linha e invocar `sdr-agent`.

Confirmei no banco:

- `SELECT * FROM cron.job` → **vazio**. Nenhum cron agendado.
- `pending_inbound_runs` tem várias linhas em `status=pending`, `scheduled_at` no passado, `attempts=0`, `claimed_at=null` — ou seja, nunca foram processadas.

Por isso a IA nunca responde: o gatilho existe, a fila é enfileirada, mas ninguém dispara o tick. O toggle Humano→IA também depende disso (ele faz upsert em `pending_inbound_runs`).

## O que fazer

Criar o cron job `sdr-debounce-tick` chamando a edge function a cada ~15s (pg_cron aceita `'15 seconds'`). Também vale re-checar/agendar os demais crons se estiverem faltando (`cadence-executor`, `intent-cron`, `expire-slot-holds`, `enrichment-cron`, `referral-followup-cron`, `slot-expiry-followup`, `cadence-reengage-cron`) — mas o foco desta correção é o `sdr-debounce-tick`.

### Passo único (via `supabase--insert` porque contém URL/anon key do projeto)

```sql
select cron.schedule(
  'sdr-debounce-tick',
  '15 seconds',
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/sdr-debounce-tick',
    headers := '{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

Garantir `create extension if not exists pg_cron;` e `pg_net` antes.

## Validação

1. `SELECT * FROM cron.job` mostra a linha `sdr-debounce-tick`.
2. Após ~30s, `pending_inbound_runs` das linhas antigas viram `status=done` (ou `running`/`failed`) e `claimed_at` preenchido.
3. No preview: enviar mensagem no modo Humano → devolver para IA → em até ~30s aparece uma nova resposta / aprovação da IA.
4. Ver logs de `sdr-debounce-tick` com invocações regulares.

## Escopo

Só criação do cron. Não altero `sdr-agent`, `inbound-webhook`, nem UI.