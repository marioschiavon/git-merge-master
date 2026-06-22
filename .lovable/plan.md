## Como testar o reengajamento sem esperar

Três caminhos, do mais rápido ao mais natural:

### 1. Botão "Testar reengajamento agora" (recomendado)
Adicionar um botão na coluna de ações de cada lead no `/cadences/dashboard` (visível só para enrollments `paused / lead_replied`). Ele chama o `cadence-reengage-cron` com `{ enrollment_id, force: true }`.

- `force=true` **pula apenas a checagem de tempo** (`reengage_after_days`).
- Continua respeitando as proteções: reunião agendada, slot_hold ativo, booking recente, max_attempts.
- Resultado aparece via toast: "Reengajado (tentativa N/M)" ou "Pulado: motivo X".

### 2. Endpoint manual via curl (para teste técnico)
O mesmo edge function aceitará `{ enrollment_id, force }` no body, então dá pra disparar pelo painel ou pelo cURL sem mexer na UI.

### 3. Ajuste temporário de config
Na aba **Config** da cadência, baixar "Dias de silêncio" para 1 — o cron de hora em hora vai pegar no próximo ciclo. Útil pra validar o fluxo end-to-end com o agendamento real.

### Mudanças técnicas

**`supabase/functions/cadence-reengage-cron/index.ts`**
Aceitar POST body opcional:
```ts
{ enrollment_id?: string, force?: boolean }
```
- Se `enrollment_id` presente → processa só aquele enrollment.
- Se `force=true` → pula o gate de "dias de silêncio" (mantém todas as outras proteções).

**`src/pages/CadencesDashboard.tsx`**
- Na coluna de ações da tabela, adicionar botão `RefreshCw` (tooltip "Testar reengajamento agora") visível quando `enrollment.status === 'paused' && enrollment.paused_reason === 'lead_replied'`.
- Ao clicar: `supabase.functions.invoke("cadence-reengage-cron", { body: { enrollment_id, force: true } })`, mostra toast com o resultado, invalida queries.

### Validação

Para o lead Juliano (paused/lead_replied, current_step=2):
1. Clica "Testar reengajamento agora".
2. Toast: "Reengajado (1/3)". Enrollment vira `active`, `next_execution_at=now()`, `reengage_attempts=1`.
3. No próximo tick do `cadence-executor` (≤ 5min) a mensagem do step 3 sai de verdade.
4. Para testar o esgotamento, clicar 3x seguidas → na 4ª vez deve aparecer "Esgotado — cadência encerrada".
