## Teste da integração Pipedrive

Token `6507d804…2898` já foi validado direto na API do Pipedrive: retornou `success:true`, usuário **Nico (nico@leaderei.com.br)**, empresa **Leaderei** (domínio `leaderei`), com persons e organizations presentes. Ou seja, o token está bom para uso.

## O que vou fazer

1. **Conectar via `pipedrive-connect`** usando o novo token para a company atual (upsert em `integrations` → `status=active`, `api_domain=leaderei.pipedrive.com`).
2. **Rodar `pipedrive-sync`** para popular a tabela `leads` a partir de persons + organizations (com fallback de website via custom fields, extração de endereço e reconciliação de deletados).
3. **Reportar** total de persons/orgs, quantos leads foram sincronizados, quantos erros e quantos removidos.
4. **Opcional (se pedir):** pegar 1 lead recém-sincronizado que tenha `website`/social e disparar `enrich-lead` para validar o pipeline ponta a ponta com este workspace.

## Detalhes técnicos

- Nenhuma alteração de código — apenas execução das edge functions existentes `pipedrive-connect` e `pipedrive-sync`.
- O token será persistido em `integrations.api_token` (já é o comportamento atual da função). Se preferir não salvar em texto claro, posso propor num plano separado migrar para `pgp_sym_encrypt` como já fazemos com Gmail/Hook7.
- Se a sincronização trouxer muitos registros, ela é paginada de 100 em 100 e pode demorar alguns segundos.

Confirma que posso conectar com este token e rodar o sync?