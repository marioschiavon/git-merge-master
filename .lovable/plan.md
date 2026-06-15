## Problema

O lead Juliano confirmou reunião para 17/06 15:30. No turno seguinte disse: *"Putz, confundi. Esse assunto não seria comigo e sim com a Carolina Rocha."* O SDR reconheceu o redirecionamento (intent `referral`) e pediu o contato da Carolina — mas a reunião confirmada com Juliano **continuou ativa** no Cal.com. Deveria ter sido cancelada automaticamente, já que ele não é mais o interlocutor.

Hoje, no branch `case "referral"` de `policy-engine.ts`, o único `post_action` é `release_slot_holds`. Holds são pre-bookings; bookings confirmados não são tocados.

## Mudanças

### 1. `supabase/functions/_shared/policy-engine.ts` — branch `referral`
Adicionar `"cancel_active_booking"` ao `post_actions` em todos os sub-casos do `case "referral"` (com contato, redirect_only, com nome, agradecendo). O handler no `sdr-agent` decide se há booking a cancelar (no-op se não houver).

Também ajustar o `response_directive` do sub-caso **referral_with_contact** e **redirect_only** para instruir o LLM a mencionar de forma natural que vai *liberar a agenda dele* / *cancelar o horário que tínhamos marcado*, evitando que o lead receba um cancelamento via email Cal.com sem contexto.

### 2. `supabase/functions/sdr-agent/index.ts` — loop `postActions`
Adicionar novo handler `cancel_active_booking` ao lado de `release_slot_holds` (linha ~1531):

```ts
} else if (pa === "cancel_active_booking") {
  // Busca booking confirmado ativo do lead
  const { data: activeBk } = await supabase
    .from("bookings")
    .select("calcom_booking_uid")
    .eq("lead_id", lead.id)
    .eq("status", "confirmed")
    .not("calcom_booking_uid", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeBk?.calcom_booking_uid) {
    // marca origem ANTES (mesmo padrão do safety-net já existente)
    // para o webhook do Cal.com não disparar a mensagem
    // "Vi que você cancelou nossa conversa…"
    await supabase.from("bookings").update({
      cancellation_source: "sdr",
      cancellation_requested_at: new Date().toISOString(),
    }).eq("calcom_booking_uid", activeBk.calcom_booking_uid);
    const { error: cxlErr } = await supabase.functions.invoke("calcom-booking-cancel", {
      body: {
        booking_uid: activeBk.calcom_booking_uid,
        reason: "Lead redirecionou o contato para outra pessoa",
        lead_id: lead.id,
      },
    });
    steps.push({ event: "post_action_cancel_active_booking", ok: !cxlErr, error: cxlErr ? String(cxlErr) : null });
  }
}
```

### 3. Teste em `supabase/functions/_shared/policy-engine_test.ts`
Adicionar caso: `intent=referral` com `referral_contact.email` → espera `post_actions` contendo `"cancel_active_booking"` e `"mark_referrer"`.

### 4. Backfill manual
Cancelar manualmente no Cal.com o booking `hn2H56t7cbF7Y5gMsPjBbt` (lead `d5e433a0-…`, Juliano, 17/06 15:30 BRT) via `calcom-booking-cancel` com `cancellation_source='sdr'` para evitar a mensagem duplicada de cancelamento.

### 5. Deploy
`sdr-agent`.

## Por que isso é seguro
- `cancel_active_booking` é idempotente: se não há booking confirmado, é no-op.
- O guard `cancellation_source='sdr'` (já implementado para o safety-net e webhook do Cal.com) suprime a mensagem automática *"Vi que você cancelou nossa conversa…"*.
- `release_slot_holds` segue rodando em paralelo para o caso de holds não convertidos.
