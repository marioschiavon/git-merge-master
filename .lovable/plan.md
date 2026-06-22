## Problema

O botão "Testar reengajamento agora" dispara `cadence-reengage-cron` com `force: true`, mas o lead exibido (Juliano) está `status='active'` e nunca respondeu. A função aplica o gate `never_engaged` **antes** de considerar `force`, então o teste manual é silenciosamente pulado (toast: "Lead ainda não respondeu nenhuma vez").

Hoje o `force=true` só ignora a janela de tempo (silêncio + `last_reengage_at`). Para um botão de teste manual ele precisa ignorar também os gates "informativos" que não representam um conflito real de fluxo.

## Mudança

### `supabase/functions/cadence-reengage-cron/index.ts`

Quando `forceMode === true`, ignorar o gate **`never_engaged`** (enrollment `active` sem inbound). Mantém todos os outros gates intactos:

- Continuam bloqueando mesmo em force: `cadence_inactive`, `reengage_disabled`, `paused_<blocked_reason>`, `paused_referral_*`, `active_slot_hold`, `recent_booking`, `reengage_attempts >= max` (esse último ainda encerra a cadência como hoje).
- Force passa a ignorar: janela de silêncio (já hoje) **+** `never_engaged` (novo).

Trecho afetado:

```ts
if ((e as any).status === "active" && !lastInboundAt) {
  details.push({ id: e.id, result: "skipped", reason: "never_engaged" });
  continue;
}
```

vira:

```ts
if (!forceMode && (e as any).status === "active" && !lastInboundAt) {
  details.push({ id: e.id, result: "skipped", reason: "never_engaged" });
  continue;
}
```

### `src/pages/CadencesDashboard.tsx`

Sem mudanças funcionais. Opcional: ajustar o label do toast `never_engaged` para algo como "Lead ainda não respondeu (use o botão para forçar)" — porém, com a mudança acima, esse skip não deve mais ocorrer via botão; ele só apareceria no cron automático, onde a mensagem atual já está correta. Recomendo **não** mexer no label.

## Resultado esperado

Clicar no botão num enrollment `active` sem nenhum inbound passa a executar o reengajamento (incrementa `reengage_attempts`, seta `next_execution_at=now()`, registra a atividade "🔄 Reengajamento N/M — disparo manual (teste)"), e o `cadence-executor` dispara a próxima mensagem no próximo tick.

## Arquivo alterado

- `supabase/functions/cadence-reengage-cron/index.ts` (uma condição)
