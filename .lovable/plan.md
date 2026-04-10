

## Registrar Atividades para Todos os Canais

### Problema
A seção "Atividades" no detalhe do lead consulta a tabela `lead_activities`, que está vazia porque o `cadence-executor` só insere atividades para WhatsApp (sem Twilio) e LinkedIn. Emails enviados e recebidos não geram registros de atividade.

### Solução

**1. `supabase/functions/cadence-executor/index.ts`**
- Após cada execução de step (email, whatsapp, linkedin), sempre inserir um registro em `lead_activities` com:
  - `type`: canal usado (email, whatsapp, linkedin)
  - `description`: resumo da ação (ex: "Email enviado - Step 2: [assunto]")
  - `metadata`: step_order, cadence_id, action (sent/failed/pending_manual), subject
- Isso garante que toda interação da cadência aparece como atividade do lead

**2. `supabase/functions/inbound-webhook/index.ts`**
- Quando uma resposta inbound é processada, inserir atividade do tipo correspondente ao canal (ex: "Email recebido: [trecho da mensagem]")

**3. Backfill de dados existentes**
- Criar registros em `lead_activities` a partir dos `execution_logs` e `messages` já existentes no banco, para que o histórico atual apareça

### Resultado
A seção "Atividades" no detalhe do lead mostrará todo o histórico: emails enviados pela cadência, respostas recebidas, e ações em outros canais.

