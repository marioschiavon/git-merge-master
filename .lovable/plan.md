## Dois bugs

### 1. UI mostra "Remarcada 03/07 16:45" mesmo após cancelamento
A reunião foi cancelada com sucesso no Cal.com e no DB (booking `9FHUQQniu6ZRouvNjMd4ze` agora está `cancelled`), mas o `BookingCard` na tela de conversas mostra a reserva ANTIGA `kAJnGRzLmRNeoBiXqGMVNX` com status `rescheduled` (16:45).

**Causa:** `useLeadBooking` (`src/hooks/useLeadBooking.ts`) pega "o primeiro não-cancelado":
```ts
const active = rows.find((r) => r.status !== "cancelled");
```
Como `rescheduled` não é cancelado, ele vence sobre o `cancelled` mais recente. Mas `rescheduled` é uma reserva morta — só vale para histórico.

**Fix:** priorizar status na ordem `confirmed > pending > rescheduled > cancelled > resto`, sempre desempatando pelo `updated_at` mais recente. Mais simples: filtrar `rows` por `status in (confirmed, pending)` e pegar o primeiro; se não houver nenhum, mostrar o mais recente independente do status (que vai ser o `cancelled` correto). Resultado: card vai mostrar "Reunião cancelada" risca­da.

### 2. Lead disse "Acho que posso amanhã. Tem horário?" e o agente travou
O agente respondeu: *"Claro, Juliano! Só um momento enquanto eu verifico os horários disponíveis para amanhã. Já te retorno com as opções."* — decisão `send_message`, sem chamar `check_calendar`, sem `offer_slots`. Não vai voltar sozinho.

**Causa:** o prompt proíbe esse padrão quando existe `date_preference` na memória, mas o lead ACABOU de declarar a preferência nesta mensagem — ainda não está em `lead_memory`. O agente interpretou como "preciso checar e volto".

**Fix no system prompt do `sdr-agent`:**
- Regra explícita: se a mensagem do lead contém uma janela temporal (amanhã, hoje, semana que vem, segunda, dia X) e ele pergunta sobre horários, é PROIBIDO usar `send_message` com texto de "vou verificar/já te retorno/só um momento". Ações obrigatórias no MESMO turno: (a) `update_lead_facts` com o `date_preference`, (b) `check_calendar` na janela, (c) finalizar com `offer_slots` (ou `send_message` informando que não há slots e propondo alternativa concreta).
- Reforçar a regra existente para cobrir o caso "date_preference acabou de chegar nesta mensagem", não apenas "já está na memória".

## O que vou alterar

1. `src/hooks/useLeadBooking.ts` — reescrever a seleção: preferir `confirmed`/`pending` (mais recente por `updated_at`); fallback para o mais recente overall. Manter o resto.
2. `supabase/functions/sdr-agent/index.ts` — adicionar duas linhas em "Regras críticas":
   - "PROIBIDO responder 'vou verificar', 'já te retorno', 'só um momento', 'me dá um instante' quando o lead pediu horários. Sempre execute `check_calendar` + `offer_slots` no MESMO turno."
   - "Se a MENSAGEM ATUAL do lead contém uma janela temporal explícita (hoje, amanhã, semana que vem, segunda, dia X), trate como `date_preference` imediata: `update_lead_facts` + `check_calendar` + `offer_slots` no mesmo turno."
3. Recolocar o Juliano nos trilhos: chamar `check_calendar` para amanhã (13/06 BRT) e enviar `offer_slots` reais via execute-action.

## Verificação

- Reabrir a conversa do Juliano: `BookingCard` desaparece ou mostra "Cancelada" (risca­da, sem botões Meet/Remarcar/Cancelar).
- Próximo "tem horário amanhã?" em qualquer lead: `sdr_agent_runs` mostra `decision=offer_slots` com slots reais; nenhuma mensagem outbound contendo "já te retorno".

## Fora do escopo

- Não vou tocar em fluxo de cadência, inbound-webhook, ou Cal.com edge functions.
- Não vou redesenhar o BookingCard além da lógica de seleção.
