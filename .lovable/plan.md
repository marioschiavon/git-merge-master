## Mudança de fase de versão: alpha → beta

Atualizar `src/lib/version.ts`:

1. **Valor atual** exibido: `beta 0.1` (substitui `alpha 0.27`).
2. **Comentário/regras** no topo do arquivo reescritos para:
   - Fase agora é **beta**.
   - A cada alteração significativa do app, bump **+0.1** (0.1 → 0.2 → 0.3 …). Múltiplas mudanças no mesmo turno contam como 1 bump.
   - **Nunca chegar a 1.0** — a versão permanece sempre em `0.X` (0.9 → 0.10 → 0.11 …), sem transição para 1.x mesmo em produção.

Nenhuma outra alteração de código: o badge no `AppSidebar` já consome `APP_VERSION` e vai refletir automaticamente.
