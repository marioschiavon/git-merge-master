# Integração MunicipIA

Novo item no menu lateral que leva o usuário ao app MunicipIA. Lá ele filtra e seleciona municípios normalmente e, ao exportar, ganha a opção **Enviar para o Leaderei**, que grava os leads direto neste app — com a cidade preenchida.

## Como vai funcionar para o usuário

1. **Menu lateral**: novo item **MunicipIA** (em Operação), visível apenas para empresas liberadas pelo master admin. Abre o MunicipIA em nova aba, já com a identificação da empresa Leaderei na URL.
2. **No MunicipIA**: o usuário usa o app normalmente (filtros, seleção de municípios).
3. **Exportar**: junto das opções de exportação existentes entra **Enviar para o Leaderei**. Ao confirmar, os registros selecionados são enviados para o Leaderei.
4. **De volta no Leaderei**: os leads aparecem em Leads com origem `municipia` e a coluna **Cidade** visível para empresas com a integração ativa.
5. **Painel master**: em Empresas, um switch **MunicipIA** liga/desliga a integração por empresa e mostra data e volume do último envio.

## Segurança do envio

O MunicipIA é outro projeto (outro backend), então o envio é feito por HTTP para um endpoint de ingestão do Leaderei, protegido por:
- um **token de ingestão por empresa**, gerado no painel master do Leaderei e configurado no MunicipIA;
- validação de que a empresa existe e está com a integração habilitada;
- deduplicação por identificador de origem, e-mail e telefone, para reenvios não duplicarem leads.

## Detalhes técnicos

**Banco (migração no Leaderei)**
- `municipia_integrations`: `company_id` (única), `enabled`, `ingest_token_hash`, `last_import_at`, `last_import_count`, `last_error`, timestamps. GRANT `SELECT` para `authenticated`, `ALL` para `service_role`. RLS: membros leem a própria linha; escrita só por master admin ou service_role.
- `leads`: adicionar `municipia_source_id text` + índice único parcial `(company_id, municipia_source_id)`. `city` já existe na tabela.

**Edge functions (Leaderei)**
- `municipia-ingest` (`verify_jwt = false`): recebe `{ company_id, leads[] }` com header `X-Municipia-Token`; valida token/habilitação, mapeia campos (nome, e-mail, telefone, empresa, site, cidade, UF), deduplica, insere com `source = 'municipia'`, atualiza `last_import_*` e grava em `audit_logs`. Retorna `{ created, updated, skipped }`.
- `municipia-admin` (master admin): habilita/desabilita a empresa e gera/rotaciona o token de ingestão (token exibido uma única vez).

**Frontend (Leaderei)**
- `src/hooks/useMunicipiaIntegration.ts`: status da empresa atual + URL do app.
- `src/components/AppSidebar.tsx`: item **MunicipIA** condicional, abrindo link externo em nova aba.
- `src/pages/master/Companies.tsx`: switch por empresa, geração de token e resumo do último import.
- `src/pages/Leads.tsx`: coluna **Cidade** exibida quando a integração está ativa.

**Do lado do MunicipIA** (mudança no outro projeto, feita depois que este lado estiver pronto): nova opção "Enviar para o Leaderei" no fluxo de exportação, que faz o POST para `municipia-ingest` com o token da empresa e o `company_id` recebido na URL.

**Versão**: bump para `beta 0.28`.

## Preciso de você

- A URL pública do app MunicipIA (para o link do menu).
- Confirmar quais campos o MunicipIA exporta hoje, para eu fechar o mapeamento de colunas dos leads.
