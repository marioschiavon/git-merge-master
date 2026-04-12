

## Salvar Mensagens Editadas do Preview para Uso na Execução

### Problema
O preview gera mensagens personalizadas e permite edição, mas nada é persistido. Quando a cadência executa, o executor gera tudo novamente, ignorando qualquer ajuste manual do SDR.

### Solução
Criar uma tabela para armazenar mensagens pré-aprovadas por lead/step. O executor verificará se existe uma mensagem salva antes de gerar uma nova.

### Detalhes técnicos

**1. Nova tabela: `cadence_custom_messages`**
- Colunas: `id`, `enrollment_id`, `step_id`, `lead_id`, `company_id`, `subject`, `message`, `created_at`, `updated_at`
- Constraint unique em `(enrollment_id, step_id)`
- RLS por `company_id`

**2. UI — Botão "Salvar" no `LeadMessagePreview`**
- Adicionar botão "Salvar mensagens" no footer do dialog
- Ao clicar, faz upsert das mensagens editadas na tabela `cadence_custom_messages`
- Feedback visual (toast) confirmando que foram salvas
- Badge indicando quais steps têm mensagem customizada salva

**3. Executor — Verificar mensagens salvas antes de gerar**
- No `cadence-executor`, antes de chamar a IA, buscar em `cadence_custom_messages` se existe mensagem para aquele `enrollment_id` + `step_id`
- Se existir, usar a mensagem salva (subject + message) em vez de gerar
- Se não existir, seguir fluxo normal (template ou IA)

**4. Preview — Carregar mensagens salvas ao abrir**
- Ao abrir o preview, verificar se já existem mensagens salvas para aquele lead/cadência
- Se existirem, exibir as salvas (em vez de regenerar com IA)
- Botão "Regenerar" continua disponível para sobrescrever

### Escopo
- 1 migração (nova tabela)
- 1 componente atualizado (botão salvar + carregar salvas)
- 1 edge function atualizada (executor verifica mensagens salvas)
- 1 edge function atualizada (preview retorna mensagens salvas se existirem)

### Resultado
O SDR pode revisar, editar e salvar as mensagens antes de iniciar a cadência. Quando a cadência executar, usará exatamente o que foi aprovado.

