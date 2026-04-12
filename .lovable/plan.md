

## Corrigir enrollment pausado de eu@julianocarneiro.com.br

### Problema
O enrollment está travado em `status: paused`, `paused_reason: awaiting_slot_confirmation`. A mensagem do prospect ("dia 15 as 17h") chegou antes do deploy da correção do `check_availability`, então caiu no fallback genérico e não respondeu. Os 4 slot_holds estão com status `held` mas já expiraram.

### Ações

**1. Correção de dados (via migração SQL):**
- Cancelar os 4 `slot_holds` expirados (`status` -> `cancelled`)
- Reativar o enrollment: `status` -> `active`, `paused_reason` -> null, `next_execution_at` -> now()

**2. Reprocessar a mensagem do prospect:**
- Chamar o `inbound-webhook` manualmente via curl com a mensagem "Eu consigo dia 15 as 17h" para que o sistema (agora corrigido) execute `check_availability` e responda ao prospect

### Escopo
- 1 correção de dados no DB
- 1 chamada manual ao inbound-webhook para reprocessar
- Nenhuma mudança de código (a correção do check_availability já foi deployada)

