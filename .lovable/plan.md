## Objetivo
Impedir que o master_admin veja/edite/exclua aprovações dos clientes. Aprovações passam a ser restritas apenas aos membros da empresa dona (via `company_id`).

## Mudança
Migração SQL substituindo as 4 policies da tabela `approval_requests`, removendo a cláusula `has_role(auth.uid(), 'master_admin')` de cada uma:

- SELECT / INSERT / UPDATE / DELETE → apenas `get_user_company_id(auth.uid()) = company_id`.

## Impacto
- Master admin deixa de ver a fila de aprovações de qualquer cliente (some da UI ao acessar como master).
- Edge functions continuam funcionando normalmente porque usam `service_role`, que bypassa RLS.
- Nenhuma alteração de frontend necessária — a página `Approvals.tsx` simplesmente retornará vazia para o master.

## Riscos
- Se algum dia o master precisar auditar aprovações, precisará usar o backend/DB diretamente ou criaremos uma tela dedicada read-only depois.
