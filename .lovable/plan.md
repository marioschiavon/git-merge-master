## Problema

A resposta automática para "quanto tempo dura?" informou **15 minutos**, mas o event type real no Cal.com tem **45 minutos**.

Causa: `getMeetingDurationMinutes()` lê `calcom_event_types.length_minutes` do banco. A linha do event type usado em agendamento (`2889964 — Secret Meeting`) está com `length_minutes = 15` (cache desatualizado desde 09/06). O Cal.com foi alterado para 45 min depois disso e nunca foi re-sincronizado.

## Solução

Tornar a duração sempre fiel ao Cal.com, consultando a API ao vivo (com fallback ao banco) e refrescando o cache.

### Mudanças

1. **`supabase/functions/_shared/meeting-duration.ts`**
   - Adicionar `resolveEventTypeId()` (mesma lógica do `calcom-slots/index.ts`: respeita secret `CALCOM_EVENT_TYPE_ID`, senão pega o primeiro event type da conta via `GET /v2/event-types`).
   - Em `getMeetingDurationMinutes()`:
     1. Tentar buscar `lengthInMinutes` ao vivo via `GET /v2/event-types/{id}` (header `cal-api-version: 2024-06-14`).
     2. Se conseguir, atualizar `calcom_event_types.length_minutes` + `synced_at` para o `calcom_id` correspondente (mantém cache fresco) e retornar o número.
     3. Em qualquer falha (sem `CALCOM_API_KEY`, rede, 4xx/5xx), cair no caminho atual baseado em DB (`calcom_default_event_type_id` → primeiro ativo).
   - Compartilhar a função `resolveEventTypeId` em `_shared/calcom.ts` (novo) para evitar duplicação com `calcom-slots`. `calcom-slots/index.ts` passa a importá-la.

2. **Validação**
   - `curl_edge_functions` no `inbound-webhook` com mensagem "Quanto tempo dura a call?" → resposta deve usar **45 minutos** (valor real do Cal.com).
   - Conferir log `MEETING_CLARIFIER_BYPASS action=reply kind=duration ... reply="É uma apresentação rápida, em torno de 45 minutos."`.
   - `SELECT length_minutes FROM calcom_event_types WHERE calcom_id = 2889964` deve passar a mostrar 45.

### Resultado esperado

A pergunta "Quanto tempo dura a reunião?" passará a responder com a duração real configurada no Cal.com no momento da resposta — sem depender de re-sync manual.
