# Diagnosticar e corrigir a falha real do cancelamento Cal.com

## Por que precisamos diagnosticar
A reserva `6z91Ph9FCRkYzJjLADy2Yu` continua `confirmed`. A linha de `calendar_actions` registrou apenas `error_message: "FunctionsHttpError: Edge Function returned a non-2xx status code"` — esse texto é do `supabase.functions.invoke` no chamador, **não** é o erro real do Cal.com. O `calcom-booking-cancel` engoliu a resposta do Cal.com no log do edge runtime e devolveu apenas um 500 genérico. Sem o corpo real, não dá pra saber se é versão de API, permissão, janela fechada, payload inválido, etc.

## Passos

### 1. Instrumentar `calcom-booking-cancel` para expor o erro real
- Trocar o `try { calcomFetch } catch { throw err }` por captura do `CalcomError` e devolver um JSON estruturado com `status`, `cal_status`, `cal_body`, `cal_message`.
- Persistir esse mesmo objeto em `calendar_actions.response_payload` mesmo no caminho de falha (hoje só grava em sucesso).
- Continuar respondendo com HTTP 502 (não 500 opaco) quando o Cal.com recusar — assim `supabase.functions.invoke` ainda dá erro, mas o body chega ao caller via `data` quando preferirmos `fetch` direto.

### 2. Capturar o body do Cal.com no caller (sdr-agent `cancel_booking`)
- Substituir o `supabase.functions.invoke("calcom-booking-cancel", ...)` por `fetch` direto para o endpoint da função (já temos `SUPABASE_URL` + service role). Isso permite ler o JSON mesmo em 4xx/5xx.
- Registrar `result.cal_status`, `result.cal_body`, `result.cal_message` no `steps` do `sdr_agent_runs` para futuras inspeções e propagar como `error_code` no fallback.

### 3. Re-executar o cancelamento e ler o erro real
Após o deploy, chamar `calcom-booking-cancel` diretamente (curl) para `booking_uid=6z91Ph9FCRkYzJjLADy2Yu`. Três cenários:
- **Sucesso** → a instabilidade era transitória; cancelar resolve e a reunião sai. Ainda assim a instrumentação fica como rede de segurança.
- **400/422 do Cal.com** → ler `cal_body` (payload inválido, versão de API errada, falta de campo). Corrigir o `calcomFetch` (versão da API ou body) e re-executar.
- **403/404** → permissão/UID inválido. Verificar se o booking pertence ao mesmo `CALCOM_API_KEY` configurado e ajustar.

### 4. Aplicar a correção pontual
Dependendo do que o passo 3 revelar:
- **API version mismatch**: testar `cal-api-version: 2024-08-13` vs `2024-09-04` no endpoint de cancel; padronizar o header certo no `calcomHeaders`.
- **Campo obrigatório faltando**: incluir `cancellationReason` non-empty (hoje já enviamos "Cliente cancelou", mas pode ser que o Cal.com exija `cancellation_reason` snake_case ou outro campo).
- **Permissão**: usar a chave correta / event type correto.

### 5. Reaprovar a fila e confirmar
Com a causa raiz corrigida, reabrir o card pendente em `/approvals`, aprovar o cancel (ou apenas reprovar e deixar o próximo turno do agente acionar `cancel_booking` de novo), confirmar:
- `bookings.status='cancelled'`,
- `calendar_actions` mais recente com `status='ok'`,
- evento `BOOKING_CANCELLED` no `calcom_webhook_log` (ou ausência confirmada via Cal.com UI).

## Fora de escopo
- Mudar o fluxo HITL (já foi feito no turno anterior).
- Alterar regras de aprovação automática para cancelamento — segue exigindo aprovação humana.

## Arquivos
- `supabase/functions/calcom-booking-cancel/index.ts` — captura + persistência do erro real, resposta 502 estruturada
- `supabase/functions/sdr-agent/index.ts` — `cancel_booking` via `fetch` direto, propagação do erro real
- Possível ajuste em `supabase/functions/_shared/calcom.ts` se o passo 3 indicar mudança de versão/headers
