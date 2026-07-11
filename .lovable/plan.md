# Atualizar manual: HITL ativado por padrão

## Contexto
Acabamos de definir `companies.hitl_enabled = true` como padrão para toda nova empresa. O manual atual (`docs/manual/11-aprovacoes.md` e menções em `01-configuracoes-gerais.md`) ainda pode dar a entender que HITL é opt-in.

## Mudanças no manual

1. **`docs/manual/11-aprovacoes.md`**
   - Adicionar nota no topo: "Por padrão, toda nova empresa entra com HITL **ativado** em todos os escopos (`first_message`, `sdr_reply`, `cadence_step`, `sensitive_action`). Nada é enviado pela IA sem aprovação humana até você desligar explicitamente."
   - Explicar como desligar (por escopo ou global) em Configurações → Empresa.
   - Reforçar: enquanto HITL estiver ligado, cadências não disparam sozinhas — as mensagens ficam em Aprovações.

2. **`docs/manual/01-configuracoes-gerais.md`**
   - Adicionar seção curta "Aprovação humana (HITL)" descrevendo o default ligado e apontando para `11-aprovacoes.md`.

3. **`docs/manual/00-primeiros-passos.md`**
   - Incluir bullet no checklist: "Revisar HITL (vem ligado por padrão) — desligue apenas quando confiar na configuração da cadência."

4. **`docs/manual/10-cadencias.md`**
   - Adicionar aviso: "Se HITL estiver ligado (padrão), cada passo gera um item em Aprovações antes de sair."

## Fora de escopo
- Nenhuma mudança de código/backend — o default no banco já foi aplicado na migration anterior.
- Não mexer no `manual.html` gerado (é build).
