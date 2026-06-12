## Problema

No modo "Enviar de verdade (live)", a mensagem do agente aparece como `sent: true` no `sdr_agent_runs`, mas o lead nunca recebe no WhatsApp.

Causa: em `supabase/functions/execute-action/index.ts`, a função `sendOutbound()` só faz envio real para `channel === "email"` (via `gmail-send`). Para `channel === "whatsapp"` ela apenas insere a mensagem na tabela `messages` e retorna `sent: true` — nunca chama a Z-API.

A Z-API já está totalmente integrada e funcionando: `supabase/functions/_shared/zapi-whatsapp.ts` (`getZApiConfig` + `sendWhatsAppViaZApi`) é usada com sucesso por `send-outbound-message`, `cadence-executor`, `slot-expiry-followup`, etc. Só falta plugar no `execute-action`, que é o caminho usado pelo agente live (`offer_slots`, `book_slot`, `send_reply`).

## Mudanças

### 1) `supabase/functions/execute-action/index.ts` — envio real via Z-API

Importar no topo:
```ts
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";
```

Em `sendOutbound`, depois de inserir a mensagem em `messages`, adicionar o bloco WhatsApp (espelhando `send-outbound-message`):

```ts
if (channel === "whatsapp") {
  const lead = await loadLead(ctx); // garantir que devolve phone/whatsapp
  const toNumber = lead?.whatsapp || lead?.phone;
  if (!toNumber) {
    return { sent: false, channel, reason: "lead sem whatsapp/phone" };
  }
  const cfg = await getZApiConfig(ctx.supabase, ctx.company_id);
  if (!cfg) {
    return { sent: false, channel, reason: "z-api não configurada" };
  }
  const r = await sendWhatsAppViaZApi(cfg, toNumber, content);
  if (!r.ok) {
    console.error("zapi send failed:", r);
    // Atualizar metadata da mensagem com delivery_status=failed
    return { sent: false, channel, error: r.error, status: r.status };
  }
  // Marcar a mensagem inserida como delivered + sid
  return { sent: true, channel, zapi_message_id: r.sid };
}
```

Também ajustar o `insert` em `messages` para gravar `metadata.delivery_status` (`delivered` / `failed` + erro), igual ao `send-outbound-message`, para a UI mostrar status correto.

Verificar/ajustar `loadLead` para incluir `whatsapp` e `phone` no `select`.

### 2) `supabase/functions/sdr-agent/index.ts` — refletir falha real

Hoje o agente marca `live.sent: true` sempre que `execute-action` retornou `ok: true`. Trocar para usar `result?.result?.sent === true` e propagar `error`/`reason`:

```ts
const sent = result?.result?.sent === true;
live: {
  action,
  ok: true,
  sent,
  result,
  error: result?.result?.error ?? result?.result?.reason ?? null,
}
```

Assim o badge "✓ enviado" em `AgentRuns.tsx` só aparece quando saiu de verdade, e exibimos motivo (`z-api não configurada`, `lead sem whatsapp`, erro Z-API) quando falha.

### 3) Deploy

Redeploy de `execute-action` e `sdr-agent`.

## Fora do escopo

- Reenviar mensagens passadas que ficaram marcadas como enviadas mas não saíram.
- LinkedIn/email continuam como estão.
- UI de configuração da Z-API (já existe e está funcionando).
