# Excluir Lead com cascata (cadências + mensagens)

## Objetivo
Permitir excluir um Lead da interface e, ao excluir, remover automaticamente:
- Inscrições em cadências (`cadence_enrollments`)
- Mensagens customizadas geradas (`cadence_custom_messages`)
- Conversas e mensagens (`conversations`, `messages`)
- Atividades, insights e logs ligados ao lead (`lead_activities`, `lead_insights`, `execution_logs`, `email_send_log`, `email_send_state`, `slot_holds`)

## Mudanças no Banco
Criar migração para garantir `ON DELETE CASCADE` nas foreign keys que apontam para `leads(id)`:
- `cadence_enrollments.lead_id`
- `cadence_custom_messages` (via enrollment) — cascade pelo enrollment
- `conversations.lead_id` → cascade
- `messages.conversation_id` → cascade (já via conversation)
- `lead_activities.lead_id`, `lead_insights.lead_id`, `execution_logs.lead_id`, `email_send_log.lead_id`, `email_send_state.lead_id`, `slot_holds.lead_id`

Se alguma FK não existir ou não tiver cascade, recriar com `ON DELETE CASCADE`.

Também adicionar policy de DELETE em `leads` para usuários da mesma `company_id` (admin/user da empresa).

## Mudanças no Frontend
- Página de Leads (lista): botão "Excluir" em cada linha + ação em massa para selecionados.
- Página de detalhe do Lead: botão "Excluir Lead" no topo.
- Usar `AlertDialog` do shadcn para confirmação ("Isso removerá o lead, suas cadências, mensagens e histórico. Não pode ser desfeito.").
- Após sucesso: toast de confirmação + redirecionar/atualizar lista.

## Detalhes Técnicos
- Delete client-side: `supabase.from('leads').delete().eq('id', leadId)`. RLS + cascade cuidam do resto.
- Invalidar queries React Query relacionadas (`leads`, `cadence_enrollments`, `conversations`).
- Sem necessidade de edge function — operação simples e segura via RLS.

## Fora do escopo
- Soft delete / lixeira (pode ser feito depois se desejar).
- Exclusão no Pipedrive (lead permanece lá; só removemos localmente).
