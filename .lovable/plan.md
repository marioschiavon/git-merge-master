## Reengajamento automático de leads silenciosos (configurável por cadência)

Fechar a lacuna onde leads que respondem e depois somem ficam em limbo, com regras configuráveis no nível da cadência e respeitando reuniões agendadas.

### Comportamento

**Quando reengaja:**
- Enrollment com `status='paused'` e `paused_reason='lead_replied'`
- Última mensagem (de qualquer lado) há ≥ N dias (configurável, default 2)
- Ainda existe próximo step na cadência
- `reengage_attempts < máximo configurado` (default 3)

**Quando NÃO reengaja (proteções):**
- `meeting_scheduled = true` ou `status='completed'` → reunião já marcada
- Existe `slot_hold` ativo (`status='held'`) → agendamento em curso
- Existe `booking` confirmado nos últimos 90 dias para o lead
- `paused_reason` é qualquer outro motivo: `human_takeover`, `awaiting_approval`, `awaiting_slot_confirmation`, `lead_rejected`, `meeting_cancelled_by_lead`, `referral_*`, `call_requested`, `handoff_required`, `hitl_pending`, `lead_requested_callback`
- Cadência tem `reengage_enabled = false`

**Quando reengaja, o que faz:**
- Retoma a cadência original: marca `status='active'`, limpa `paused_reason`, define `next_execution_at=now()`, incrementa `reengage_attempts`, grava `last_reengage_at`. O `cadence-executor` envia o próximo step no ciclo seguinte.

**Quando lead responde novamente:**
- `inbound-webhook` zera `reengage_attempts = 0` ao pausar com `lead_replied`. Contagem recomeça do zero.

**Quando esgotam as tentativas:**
- `status='completed'`, `paused_reason='no_response_after_reengage'`, registra `lead_intents_log(category='no_response')`.

### Configurações por cadência (UI em `/cadences`)

Novo bloco "Reengajamento" no diálogo de **criação** e em uma nova aba **"Configurações"** do `CadenceDetail`:

- **Switch** "Reengajar leads silenciosos" (default ON)
- **Slider/Input** "Dias de silêncio antes de reengajar" (1–14, default 2)
- **Slider/Input** "Máximo de tentativas" (1–5, default 3)
- Texto auxiliar explicando que reuniões agendadas pausam o reengajamento automaticamente

### Mudanças técnicas

**1. Migration**
- `cadences`: `reengage_enabled BOOLEAN DEFAULT true`, `reengage_after_days INT DEFAULT 2`, `reengage_max_attempts INT DEFAULT 3`
- `cadence_enrollments`: `reengage_attempts INT DEFAULT 0`, `last_reengage_at TIMESTAMPTZ`

**2. Novo edge function `cadence-reengage-cron`**
Roda de hora em hora via `pg_cron`. Lê config da cadência, aplica filtros de silêncio + proteções (meeting/slot_hold/booking), retoma ou encerra.

**3. `inbound-webhook`**
No bloco que faz `update paused_reason='lead_replied'`, incluir `reengage_attempts: 0`.

**4. UI**
- `src/pages/Cadences.tsx` (`CreateCadenceDialog`): adicionar bloco "Reengajamento" com os 3 campos.
- `src/components/CadenceDetail.tsx`: nova aba "Configurações" com mesmos campos (editáveis) + botão salvar.
- `src/pages/CadencesDashboard.tsx`: badge `Reengajamento 1/3`, `2/3`, `3/3` na coluna de status quando `reengage_attempts > 0`.

**5. Cron**
`pg_cron` chamando `cadence-reengage-cron` a cada hora.

### Validação

- Lead Juliano (`paused / lead_replied`, current_step=2, sem reunião) → após 2 dias, cron reativa para step 3, `reengage_attempts=1`.
- Se ele agendar reunião antes → enrollment vira `completed/meeting_scheduled=true` e o cron ignora.
- Se ele responder de novo após o reengajamento → volta a `paused/lead_replied`, contador zera, ciclo recomeça.
- Após 3 tentativas sem resposta → `completed / no_response_after_reengage`.

### Fora do escopo
- Não mexe na lógica de SDR durante conversa ativa.
- Não corrige o bug visual de "Ativo" no dashboard quando enrollment está pausado (separado).
