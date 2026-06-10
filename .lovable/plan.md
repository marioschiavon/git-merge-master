
## Objetivo

Quando os horários reservados expirarem (Eduardo Mattos é o caso atual), o SDR deve **sugerir 2 novos horários** em vez de já mandar o link do Cal.com. Só se o lead **não responder** a essa nova tentativa em 24h é que enviamos o link como último recurso. E definir o que fazer com a cadência quando o lead simplesmente para de responder.

## Comportamento novo

### 1. Slots expirados — fluxo em 2 passos

**Hoje:** `expire-slot-holds` envia 1 mensagem com link do Cal.com e encerra.
**Novo:**

- **Passo A (no momento da expiração):** cancela os holds antigos, busca **2 novos slots** via Cal.com, faz hold de 24h e envia mensagem do tipo:
  > "Eduardo, infelizmente os horários que reservamos (qui 11/06 20:30 e seg 15/06 20:00) foram ocupados. Consegui liberar dois novos: **quarta 17/06 às 19:00** ou **sexta 19/06 às 20:30**. Algum funciona?"
- **Passo B (fallback, 24h depois sem resposta):** se o lead não respondeu e os novos holds expiraram sem confirmação, aí sim mandamos o link genérico do Cal.com — **uma única vez**.
- Se Cal.com não retornar slots novos (sem disponibilidade), cai direto no fallback com link.

### 2. Cadência quando o lead para de responder

Hoje, quando o lead responde, a cadência pausa (`paused_reason=lead_replied`). Se ele depois **silencia**, não há tratamento — fica parada para sempre.

Proposta (configurável; defaults abaixo):

- Após **3 tentativas de re-engajamento sem resposta** (incluindo a sugestão de novos horários + link fallback + 1 follow-up final "ainda faz sentido conversarmos?"), a enrollment vira `status = completed` com `paused_reason = no_response` e o lead vai para `status = cold` em `leads`.
- Espaçamento entre tentativas: 24h, 48h, 72h.
- Se em qualquer momento o lead responder, a cadência reativa normalmente (lógica já existe).

## Mudanças técnicas

### `supabase/functions/expire-slot-holds/index.ts`
- Remover a montagem da mensagem com link e a chamada de envio direto.
- Em vez disso: para cada lead com holds expirados, **invocar uma nova função `slot-expiry-followup`** (ou chamar `execute-action` com um action novo `suggest_new_slots_after_expiry`).
- Manter o cancelamento dos holds no Cal.com e a marcação `status=expired`.

### Nova função `supabase/functions/slot-expiry-followup/index.ts`
- Recebe `{ lead_id, company_id, expired_slots: [...] }`.
- Chama `calcom-slots` para buscar 2 novos horários futuros.
- Se encontrou: cria 2 `slot_holds` novos (`status=held`, `expires_at = now()+24h`, metadata `{ origin: "expiry_retry", retry_count: 1 }`), monta a mensagem citando os horários antigos + novos, envia pelo canal preferido (mesma lógica de `preferredChannel` atual) e registra activity.
- Se não encontrou slots ou se `retry_count >= 1` (segunda expiração): envia mensagem com link Cal.com (fallback atual) e marca `final_link_sent=true` na activity.

### `lead_action_queue` / cron
- `intent-cron` (que já roda) passa a verificar holds com `metadata.origin = expiry_retry`, `status = expired` e sem resposta posterior do lead → enfileira o fallback com link (caminho B).
- Se já houve `final_link_sent` e ainda sem resposta após 48h → enfileira mensagem de encerramento ("ainda faz sentido conversarmos?"). Se sem resposta após mais 72h → marca enrollment `completed/no_response` e `leads.status=cold`.

### Frontend
- Sem mudanças de UI obrigatórias. Opcional (não incluído nesta fase): card de configuração em Settings para ajustar prazos (24h/48h/72h) e nº de tentativas.

## Diagrama do fluxo

```
Holds expiram
   │
   ├─ Cal.com tem 2 slots novos?
   │      ├─ SIM → envia "consegui liberar X e Y", hold 24h (retry_count=1)
   │      │           │
   │      │           ├─ lead responde → fluxo normal (confirm/reject)
   │      │           └─ 24h sem resposta → fallback link Cal.com (final_link_sent)
   │      │                        │
   │      │                        ├─ lead responde → fluxo normal
   │      │                        └─ 48h sem resposta → "ainda faz sentido?"
   │      │                                       │
   │      │                                       └─ 72h sem resposta →
   │      │                                          enrollment completed/no_response
   │      │                                          leads.status = cold
   │      └─ NÃO → fallback link direto
```

## Fora de escopo
- Substituição do Twilio (assunto anterior em aberto).
- UI de configuração dos prazos.
