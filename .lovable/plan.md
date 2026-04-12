

## Corrigir `check_availability` que não funciona sem slots existentes

### Diagnóstico

O log confirma: `check_availability requested but no held slots found — falling back to reply`

O problema está na linha 255 do `inbound-webhook`:
```typescript
if ((parsed.action === "reject_slots" || parsed.action === "check_availability") && heldSlots.length === 0) {
  parsed.action = "reply";
  parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
}
```

`check_availability` NÃO precisa de slots existentes — o prospect está sugerindo um horário NOVO. Mas o fallback impede que o código real (linhas 367-430) execute, e a resposta genérica "Como posso ajudá-lo?" é enviada.

### Mudança

**`supabase/functions/inbound-webhook/index.ts`** — Separar `check_availability` do fallback de `reject_slots`:

- Linha 255: remover `parsed.action === "check_availability"` da condição
- Manter o fallback apenas para `reject_slots` sem slots
- `check_availability` deve sempre executar normalmente (linhas 367+), mesmo sem slots held — o código já lida com `heldSlots` vazio no loop de cancelamento (simplesmente não cancela nada)

Mudança de 1 linha:
```typescript
// ANTES
if ((parsed.action === "reject_slots" || parsed.action === "check_availability") && heldSlots.length === 0) {

// DEPOIS  
if (parsed.action === "reject_slots" && heldSlots.length === 0) {
```

### Escopo
- 1 edge function atualizada (`inbound-webhook`)
- Mudança de 1 linha
- Re-deploy da função

