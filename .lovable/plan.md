

## Plano: Resetar enrollment e testar envio de email

### Contexto
- Lead **Juliano Carneiro** (`eu@julianocarneiro.com.br`) está com enrollment `completed` na cadência `516f4cdb-96bb-440b-b339-27c22b25c18b`
- A cadência tem 1 step (email, step_order=1)
- Domínio `notify.internetsegura.com.br` agora está verificado

### Ações

1. **Resetar o enrollment** via query UPDATE:
   - `status = 'active'`, `current_step = 1`, `next_execution_at = NOW()`, `completed_at = NULL`, `last_executed_at = NULL`
   - Enrollment ID: `f4fc0b09-5772-4079-9f84-bc7de9695bb7`

2. **Executar a cadência** chamando a edge function `cadence-executor` para processar o enrollment imediatamente

3. **Verificar os logs** de execução e envio de email para confirmar que o email foi gerado e enviado com sucesso

### Detalhes técnicos
- O reset será feito via migration (UPDATE no enrollment)
- A execução será via `supabase--curl_edge_functions` chamando `cadence-executor`
- Verificação via `execution_logs` e `email_send_log`

