

## Buscar Event Type ID automaticamente via API do Cal.com

### Problema
O `CALCOM_EVENT_TYPE_ID` está configurado como secret manual e com valor incorreto (não numérico), causando erro 400 na busca de slots. O usuário quer que o sistema descubra o Event Type ID automaticamente via API.

### Solução
Modificar `calcom-slots` para buscar o primeiro event type disponível via `GET /v2/event-types` quando o secret `CALCOM_EVENT_TYPE_ID` não estiver configurado ou for inválido. Isso elimina a necessidade de configurar manualmente o ID.

### Mudanças

**1. `supabase/functions/calcom-slots/index.ts`**
- Adicionar função `fetchEventTypeId()` que chama `GET https://api.cal.com/v2/event-types` com header `cal-api-version: 2024-06-14` (versão específica para event types)
- Se `CALCOM_EVENT_TYPE_ID` estiver configurado e for numérico, usar ele (comportamento atual)
- Se não, chamar a API para listar event types e usar o primeiro retornado (`data[0].id`)
- Logar o ID encontrado para debug

**2. `src/pages/settings/Integrations.tsx`**
- Atualizar o card do Cal.com: remover `CALCOM_EVENT_TYPE_ID` da lista de obrigatórios e marcar como opcional
- Adicionar nota: "O Event Type ID é detectado automaticamente. Configure apenas se quiser forçar um tipo específico."

### Detalhes técnicos

```typescript
// Nova função em calcom-slots
async function resolveEventTypeId(apiKey: string): Promise<number> {
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) {
    return Number(manualId);
  }

  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "cal-api-version": "2024-06-14",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch event types: ${res.status}`);
  const json = await res.json();
  const eventTypes = json.data?.eventTypes || json.data || [];
  if (!eventTypes.length) throw new Error("No event types found in Cal.com");

  console.log(`Auto-detected event type: ${eventTypes[0].id} (${eventTypes[0].title})`);
  return eventTypes[0].id;
}
```

### Escopo
- 1 edge function atualizada (`calcom-slots`)
- 1 página atualizada (Integrations — card Cal.com)
- Nenhuma mudança de banco

