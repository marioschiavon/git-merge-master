# Reunião confirmada → remarcada → cancelada em sequência

## O que aconteceu (lead a6ba77a3…, mensagem "Dia 15" às 13:42:12)

Reconstrução pelos `messages`, `bookings`, `calendar_actions`, `sdr_agent_runs` e logs do `inbound-webhook`:

```text
13:42:12  inbound "Dia 15"
13:42:13  inbound-webhook boot — dedup OK (registra processed_inbound_messages)
13:42:18  inbound-webhook → invoca sdr-agent em mode="shadow" (background)
                    e CONTINUA o pipeline legado em paralelo
13:42:28  sdr-agent.book_slot → cria calendar_action(book, ok, uid 73sdv…)
13:42:36  calcom-confirm-booking envia "📅 Reunião confirmada 15/06 17:45"
13:42:50  cal.com webhook insere a row em `bookings` (status=confirmed)
13:42:50  pipeline legado classifica "Dia 15" como reschedule
                    (sugestão AI 15/06 20:00 ≠ slot bookado 20:45)
                    → entra no branch reschedule
13:42:51  cancela 73sdv… na Cal.com (e dispara "❌ cancelada" + novas opções)
```

A guarda "booking recente < 90s" no branch reschedule não disparou porque a row em `bookings` só foi inserida ~500 ms **depois** da query (insert é assíncrono via webhook do Cal.com). A `calendar_action` correspondente já existia há 22 s, mas a guarda não a consulta.

`lead.pipeline_mode = 'legacy'`, então `isAgentMode=false` e o legado **deve** rodar. O problema real é que o sdr-agent em `mode="shadow"` **não é shadow** — ele invoca `calcom-confirm-booking` e cria booking de verdade. Por isso temos dois donos para o mesmo turno e eles brigam.

## Correções

### A. sdr-agent: shadow mode deixa de mutar estado (causa raiz)

Em `supabase/functions/sdr-agent/index.ts`, dentro de `execBookingTool` (linhas ~428–610), respeitar `mode`:

- Receber `mode` no contexto da execução do tool (propagar do handler principal, ~linha 1007, até `execBookingTool`).
- Quando `mode === "shadow"`, **não** chamar `calcom-confirm-booking`, `calcom-booking-reschedule`, `calcom-booking-cancel`, e **não** criar/atualizar `calendar_actions` nem `bookings`.
- Retornar um payload sintético `{ ok: true, simulated: true, booking_uid: "shadow", scheduled_at: slotStart, message_suggestion: "[shadow] …" }` para o LLM seguir o fluxo e gerar a `finalize`.
- Pular `claimCalendarAction` em shadow (ou usar uma versão `dryRun` que só faz `select`, nunca `insert`).
- Atualizar comentário do topo do arquivo já confirma "In shadow mode, nothing is sent or enqueued" — alinhar o comportamento à intenção.

### B. inbound-webhook: guarda anti-reschedule consulta também `calendar_actions`

Em `supabase/functions/inbound-webhook/index.ts`, branch `reschedule` (linhas 1494–1517), ampliar o RESCHEDULE_SKIPPED_RECENT_BOOKING para cobrir a janela em que `bookings` ainda não foi persistido:

- Além do `select` em `bookings`, fazer um segundo `select` em `calendar_actions` filtrando `lead_id`, `action_type in ('book','reschedule')`, `status='ok'`, `created_at >= now() - 120s`.
- Se qualquer das duas consultas retornar algo, abortar reschedule (mesma lógica atual: vira `parsed.action='reply'` com mensagem confirmando o horário).
- Aumentar a janela de bookings de 90s → 120s para emparelhar com `calendar_actions`.

### C. (Defesa em profundidade) Não escalar shadow para reschedule "compensado" pela AI

Ainda em `inbound-webhook`, quando o classificador compensa `suggested_datetime` da AI e cai em reschedule (linha ~981 → 1490), exigir confirmação explícita do usuário antes de cancelar:

- Se `parsed.confidence < 0.85` **ou** o usuário não mencionou explicitamente "remarcar/mudar/trocar/cancelar" no `cleanContent`, fazer downgrade para `reply` perguntando "Quer trocar o horário atual ou confirmar este?" em vez de cancelar.
- Regex simples: `/\b(remarcar|remarcação|mudar.*horário|trocar.*horário|desmarcar|cancelar|outro\s+(dia|horário))\b/i`.

## Arquivos afetados

- `supabase/functions/sdr-agent/index.ts` — propagar `mode` e curto-circuitar tools de booking em shadow.
- `supabase/functions/inbound-webhook/index.ts` — guarda ampliada (B) e gating de reschedule "compensado" (C).

## Validação

1. Reabrir uma conversa de teste e enviar "Dia 15" com booking ativo em outro dia.
2. Conferir nos logs: `sdr-agent shadow` retorna `simulated:true` e **nenhuma** row nova em `calendar_actions`/`bookings`.
3. Conferir que o pipeline legado é o único a agir, sem mensagens duplicadas.
4. Repetir cenário com `pipeline_mode='agent'` para garantir que o caminho live continua funcionando (B/C não devem afetar agent mode, que já bypassa o legado).
5. Testar reschedule legítimo ("quero remarcar para dia 16") e confirmar que C deixa passar.
