# Excluir DIAS inteiros (não só horários) ao oferecer novos slots em reject_slots

## Problema observado
Na conversa do Ju, ele rejeitou os horários oferecidos e pediu outras opções de **dia**. O SDR ofereceu novos horários, mas nos **mesmos dias** (12/06 e 15/06). Logs confirmam:

```
Excluding previously offered datetimes: [ "2026-06-12T19:45:00+00:00", "2026-06-15T20:00:00+00:00" ]
Slot reserved: 2026-06-12T19:00:00 ... 2026-06-15T12:45:00
```

A exclusão hoje é só por timestamp (`exclude_datetimes`) — diferenças de minutos no mesmo dia passam.

## Solução
Adicionar exclusão por **dia inteiro** no fluxo de rejeição de slots.

### `supabase/functions/calcom-slots/index.ts`
- Aceitar novo parâmetro opcional `exclude_dates: string[]` (YYYY-MM-DD em `America/Sao_Paulo`).
- Em `pickSpreadSlots`, antes de filtrar slots, descartar qualquer `date` cuja chave (já em YYYY-MM-DD na TZ do Cal.com) esteja no set.
- Log: `Excluding N previously offered dates`.

### `supabase/functions/inbound-webhook/index.ts` (branch `reject_slots`)
- Calcular `excludeDates` a partir de `heldSlots` + `lastOfferedSlots`, convertendo cada datetime para `YYYY-MM-DD` em `America/Sao_Paulo`.
- Passar no body do `calcom-slots`:
  ```
  exclude_datetimes: [...],
  exclude_dates: excludeDates,
  ```
- Manter `exclude_datetimes` para retro-compat (outros caminhos).

### Considerações
- Mantém `start_after`/`end_before` se o lead deu hint de range ("semana que vem").
- Se não houver disponibilidade fora dos dias excluídos, o fallback existente (`CALCOM_BOOKING_LINK`) continua valendo.
- Sem mudança de schema, sem mudança em UI.

## Fora de escopo
- Reescrever o filtro de exclusão para todos os outros caminhos do `calcom-slots` (só o reject_slots passa `exclude_dates`).
- Detectar via NLP se o lead pediu "outro dia" vs "outro horário" — no reject_slots assumimos sempre que o lead quer dias diferentes.
