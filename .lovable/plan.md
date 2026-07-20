## Diagnóstico

Confirmei no banco:
- A empresa do usuário (`b9876b4c…`) tem **34 anotações** salvas.
- As RLS policies de `message_annotations` estão corretas (`SELECT` liberado para membros da mesma company e master_admin) e o grant SELECT para `authenticated` existe.
- **Causa real:** a tabela `message_annotations` não tem nenhuma foreign key. O hook `useAnnotations` faz um embed PostgREST (`select("*, leads(id, name, company_name, email)")`) que exige uma FK detectável entre `message_annotations.lead_id` e `leads.id`. Sem essa FK, o PostgREST responde erro (`Could not find a relationship…`) e o React Query devolve `[]` — por isso a tela mostra "Nenhuma anotação ainda" mesmo com 34 registros salvos.

## Correção

Migration adicionando as FKs faltantes em `public.message_annotations`:
- `lead_id` → `public.leads(id) ON DELETE SET NULL`
- `conversation_id` → `public.conversations(id) ON DELETE SET NULL`
- `company_id` → `public.companies(id) ON DELETE CASCADE`

Depois disso o embed `leads(...)` funciona e a listagem passa a exibir as anotações normalmente. Nenhuma alteração de UI necessária.

## Verificação

1. Rodar `select ... leads(...)` via PostgREST como usuário autenticado da empresa e confirmar retorno populado.
2. Abrir a página **Anotações** com o login afetado e confirmar que as 34 anotações aparecem.