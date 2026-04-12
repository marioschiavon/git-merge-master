

## Adicionar botão "Resetar dados de teste" na página de Conversas

### O que será feito

Adicionar um botão visível apenas para admins na página de Conversas que limpa todos os dados de teste de uma vez:

1. **Edge function `reset-test-data`** — recebe o `company_id` do usuário autenticado e executa:
   - `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE company_id = $1)`
   - `DELETE FROM conversations WHERE company_id = $1`
   - `DELETE FROM slot_holds WHERE company_id = $1`
   - `DELETE FROM lead_activities WHERE company_id = $1 AND type = 'meeting'`
   - `UPDATE cadence_enrollments SET status = 'active', meeting_scheduled = false, completed_at = NULL WHERE company_id = $1 AND meeting_scheduled = true`

2. **Botão na UI** (`Conversations.tsx`) — botão "Resetar testes" com confirmação (dialog) que chama a edge function. Aparece ao lado do título.

### Escopo
- 1 nova edge function: `reset-test-data/index.ts`
- 1 arquivo editado: `src/pages/Conversations.tsx` (botão + dialog)
- Config: `supabase/config.toml` — adicionar `verify_jwt = false` para a função
- Sem mudanças de banco de dados

### Resultado
- Um clique limpa conversas, mensagens, slot_holds, atividades de meeting e reseta enrollments
- Pronto para testar agendamentos do zero

