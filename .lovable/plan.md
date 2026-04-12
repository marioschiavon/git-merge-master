

## Sincronização Bidirecional: Deletar e Atualizar Leads do Pipedrive

### Problema
A sincronização atual só faz **upsert** — insere novos e atualiza existentes pelo `pipedrive_id`. Mas leads deletados no Pipedrive continuam no sistema, e campos atualizados (nome, email, telefone, empresa) podem não refletir corretamente.

### Solução

Alterar `supabase/functions/pipedrive-sync/index.ts` para adicionar uma etapa de **reconciliação** após o upsert:

1. **Após o upsert**, buscar todos os leads da empresa com `source = 'pipedrive'` e `pipedrive_id IS NOT NULL`
2. **Comparar** os `pipedrive_id` do banco com os IDs retornados pela API do Pipedrive
3. **Deletar** (ou marcar como removidos) os leads que existem no banco mas não existem mais no Pipedrive

### Detalhes técnicos

**Arquivo: `supabase/functions/pipedrive-sync/index.ts`**

Após o loop de upsert, adicionar:

```typescript
// Reconciliation: remove leads deleted from Pipedrive
const pipedriveIds = new Set(persons.map((p: any) => p.id));

const { data: existingLeads } = await supabase
  .from("leads")
  .select("id, pipedrive_id")
  .eq("company_id", company_id)
  .eq("source", "pipedrive")
  .not("pipedrive_id", "is", null);

let removed = 0;
for (const lead of existingLeads || []) {
  if (!pipedriveIds.has(lead.pipedrive_id)) {
    await supabase.from("leads").delete().eq("id", lead.id);
    removed++;
  }
}
```

- Retornar `removed` no response JSON para feedback ao usuário
- O upsert existente já cuida de **atualizações** de campos (nome, email, etc.) — isso funciona porque usa `onConflict: "company_id,pipedrive_id"`

### Escopo
- 1 arquivo: `supabase/functions/pipedrive-sync/index.ts`
- Redeploy da edge function

### Resultado
Ao sincronizar, leads deletados no Pipedrive serão removidos do sistema. Leads atualizados já são cobertos pelo upsert existente. O toast mostrará quantos foram sincronizados e quantos foram removidos.

