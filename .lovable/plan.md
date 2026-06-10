## O que muda

Quando a IA detecta confirmação de horário na conversa (WhatsApp ou outro canal), o convite do Cal.com sempre vai por e-mail. Se o lead não tem e-mail cadastrado, o bot pede educadamente. Se o lead recusar ou disser que não tem, a reunião é confirmada mesmo assim com e-mail placeholder e o SDR é avisado. Mensagem pós-agendamento fica curta e cordial.

## Fluxo novo

```text
confirm_slot detectado
  ├─ lead tem email?
  │    ├─ SIM → confirma no Cal.com → mensagem cordial curta
  │    └─ NÃO → pergunta email + marca pending_email_for_slot
  │
provided_email na próxima msg (IA detecta)?
  ├─ SIM → salva em leads.email → confirma → mensagem cordial
  └─ recusa explícita → confirma com placeholder + atividade interna "SDR precisa enviar convite manual"
```

## Mudanças técnicas

1. **Migração** — adicionar `pending_email_slot_hold_id uuid` em `leads` (lembra qual slot está aguardando e-mail). Limpo após confirmação.

2. **`inbound-webhook/index.ts`**
   - Estender o JSON da IA com 2 campos novos: `provided_email` (string|null) e `email_refused` (bool).
   - Atualizar o system prompt para:
     - Quando `action=confirm_slot` e lead sem e-mail → forçar `action=request_email` (nova ação) com `reply_message` cordial pedindo e-mail
     - Quando há `pending_email_slot_hold_id` e o lead responde com e-mail → setar `provided_email`
     - Quando lead recusa/diz não ter → `email_refused=true`
   - Nova branch `action=request_email`: salva `pending_email_slot_hold_id` no lead e envia a pergunta.
   - Branch existente `confirm_slot`: se `provided_email` veio, atualiza `leads.email` antes de chamar `calcom-confirm-booking`. Se `email_refused=true`, passa `force_placeholder=true`.
   - Mensagem pós-confirmação: deixar a IA gerar (remover o template hardcoded "Perfeito! Reunião confirmada... Você receberá um convite..."). Adicionar instrução no prompt: "Após confirmar, gere mensagem curta cordial (1–2 frases), mencione data/hora, sem floreios."

3. **`calcom-confirm-booking/index.ts`**
   - Aceitar novo parâmetro `force_placeholder: boolean`.
   - Se lead sem e-mail e `force_placeholder=true` → usar `noreply+{lead_id}@{SENDER_DOMAIN ou app domain}`, criar booking no Cal.com normalmente, e inserir `lead_activities` tipo `alert` com descrição "⚠️ Reunião confirmada sem e-mail real do lead — enviar convite manualmente".
   - Se sem e-mail e sem `force_placeholder` → continuar retornando 400 (não deve ocorrer no fluxo novo, mas mantém guarda).

4. **`booking-messages.ts`** — sem mudança estrutural; a system message de booking_created continua.

## Fora de escopo

- UI específica para mostrar o alerta de "convite manual pendente" (a atividade já aparece no LeadDetail).
- Reenviar convite manualmente pelo app — fica no fluxo Cal.com padrão por enquanto.
- Validar formato do e-mail extraído além de regex básico embutido no save.

## Ordem de execução

1. Migração (`pending_email_slot_hold_id`)
2. `calcom-confirm-booking` (placeholder + alerta)
3. `inbound-webhook` (prompt + nova action `request_email` + captura `provided_email`)
4. Deploy das duas edge functions
