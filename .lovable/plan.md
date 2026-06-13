## Diagnóstico

Achei a causa. O webhook reconheceu corretamente que **foi o lead** que cancelou (o Cal.com mandou `payload.cancelledBy: "eu@julianocarneiro.com.br"`, e a comparação com o e-mail do lead bateu). O problema está no INSERT em `lead_action_queue`:

O código do `calcom-webhook/index.ts` enfileira assim:

```ts
await supabase.from("lead_action_queue").insert({
  company_id, lead_id, action_type, payload, status, scheduled_for, source: "calcom_webhook",
});
```

Mas a tabela `lead_action_queue` **não tem** as colunas `payload` nem `source`. As colunas reais são:

```
id, company_id, lead_id, conversation_id, intent_log_id, action_type,
params, scheduled_for, status, triggered_by, attempts, executed_at,
result, error, created_at, updated_at
```

Como o resultado do `.insert()` não é checado (`await` sem ler `error`), o erro do PostgREST é silenciosamente descartado, `calcom_webhook_log.processed=true` fica `true` sem `error`, e nenhuma linha é criada na fila → o `execute-action` nunca roda o `acknowledge_cancellation`.

A mesma confusão de nomes existe na checagem de idempotência (`payload->>booking_uid`) — também não acharia nada porque a coluna correta é `params`.

E o `execute-action` já lê tudo de `ctx.params` (linha 642: `const { booking_uid } = ctx.params;`), então é mesmo só o webhook que está usando os nomes errados.

## O que mudar

### `supabase/functions/calcom-webhook/index.ts`

1. **Helper `enqueue`** — trocar:
   - `payload` → `params`
   - `source: "calcom_webhook"` → `triggered_by: "calcom_webhook"`
   - Adicionar checagem de `error` retornado pelo `.insert()` e logar/anexar em `calcom_webhook_log.error` se falhar (para não voltarmos a engolir esse tipo de bug).

2. **Idempotency guard** do `BOOKING_CANCELLED` — trocar `payload->>booking_uid` por `params->>booking_uid` na query.

3. Confirmar (sem mexer) que todas as outras chamadas ao `enqueue` (`send_booking_confirmation`, `update_lead_score`, `recover_no_show`, `send_meeting_recap`, `request_feedback`) passam a inserir de verdade — hoje **nenhuma** delas funciona pelo mesmo motivo.

## Fora do escopo

- Não vou mexer no `execute-action` (já lê `params` corretamente).
- Não vou mexer no plano anterior de tom da mensagem, source detection nem `BOOKING_RESCHEDULED` — tudo isso já está certo, só não rodava porque a fila não recebia a linha.
- Não vou criar coluna nova nem migração.

## Verificação

1. Cancelar uma reserva de teste pelo link do email do Cal.com.
2. Conferir em `lead_action_queue` que aparece uma linha `action_type='acknowledge_cancellation'` com `triggered_by='calcom_webhook'` e `params->>booking_uid` preenchido.
3. Conferir que o `execute-action` processa essa linha e o lead recebe a mensagem de retomada no canal preferido.
4. Repetir o teste no mesmo booking dentro de 24h → guard de idempotência deve impedir uma segunda enfileiragem.
