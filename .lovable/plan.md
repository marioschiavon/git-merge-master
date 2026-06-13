## Diagnóstico

Log do `calcom-webhook` durante o cancelamento:

```
calcom-webhook: cancellation not initiated by lead (cancelledBy=unknown), skipping follow-up.
```

A regra atual em `supabase/functions/calcom-webhook/index.ts` (linhas 133-142) só considera "cancelamento pelo lead" quando o payload do Cal.com traz um `cancelledByEmail` **preenchido**:

```ts
const cancelledByLead =
  !!cancelledByEmail &&
  (cancelledByEmail === leadEmailLower ||
    (!!organizerEmailLower && cancelledByEmail !== organizerEmailLower));
```

Quando o lead cancela pelo **link público do e-mail** (sem estar logado em uma conta Cal.com), o Cal envia o webhook com `cancelledByEmail = ""` / `cancelledBy = null`. Resultado: `cancelledByLead = false` → `acknowledge_cancellation` não é enfileirado e o SDR não envia mensagem de retomada.

Confirmação no booking original: o objeto `booking` retornado já mostrava `"cancelledByEmail": ""` mesmo após criação — Cal.com simplesmente não popula esse campo para cancelamentos anônimos via link.

## Correção

Inverter a lógica para um modelo "presumir lead salvo se for claramente o organizador":

- Se `cancelledByEmail` está **vazio/unknown** → tratar como **cancelamento do lead** (caso típico do link público).
- Se `cancelledByEmail` é igual ao **organizador** (SDR/host) → pular o follow-up (SDR já sabe).
- Se `cancelledByEmail` é igual ao **lead** → seguir com follow-up (caso já tratado hoje).
- Qualquer outro e-mail → assumir terceiro/lead também (manter follow-up).

### Mudanças

**Arquivo: `supabase/functions/calcom-webhook/index.ts`**

1. Substituir o cálculo de `cancelledByLead` por:
   ```ts
   const cancelledByOrganizer =
     !!cancelledByEmail &&
     !!organizerEmailLower &&
     cancelledByEmail === organizerEmailLower;
   const cancelledByLead = !cancelledByOrganizer; // inclui empty/unknown e qualquer não-organizador
   ```
2. Ajustar a mensagem de log para refletir a nova semântica:
   - quando pula: `"cancellation initiated by organizer (${cancelledByEmail}), skipping follow-up."`
   - quando segue: continuar sem log (ou debug com `cancelledByEmail || "unknown"`).
3. A trava de idempotência existente (24h por `booking_uid`) continua protegendo de mensagens duplicadas, então não há risco de enviar follow-up duas vezes se o Cal reentregar o webhook.

### Fora de escopo

- Sem mudança no `execute-action` (mensagem `acknowledge_cancellation` já existe e está correta).
- Sem mudança no `sdr-agent`.
- Sem alteração em `BOOKING_RESCHEDULED` (lead remarcando pelo link continua sem nova mensagem, conforme decisão anterior).

## Verificação

1. Cancelar uma reunião teste pelo link do Cal.com (sem login no Cal).
2. Conferir no log: `calcom-webhook` **não** deve registrar "skipping follow-up".
3. Conferir `lead_action_queue`: novo registro `action_type='acknowledge_cancellation'`, `triggered_by='calcom_webhook'`, `params->>booking_uid` preenchido.
4. Conferir conversa: SDR envia mensagem de retomada perguntando se quer reagendar.
5. Repetir o cancelamento (Cal reentrega o webhook) → idempotência impede segundo envio.
