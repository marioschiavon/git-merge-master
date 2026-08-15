# Integração Municipal Connect Pro

Importação manual de leads do Municipal Connect Pro para o Leaderei, liberada empresa a empresa pelo master admin, com a cidade do lead visível para quem tem a integração ativa.

## Como vai funcionar

1. No painel master (Empresas), cada empresa ganha um botão **Municipal Connect Pro**. Ali o master:
   - liga/desliga a integração para aquela empresa;
   - informa qual município/tenant do Municipal Connect Pro alimenta essa empresa (opcional, para filtrar a origem);
   - vê a data da última importação e quantos leads vieram.
2. O cliente (empresa liberada) vê um card **Municipal Connect Pro** em Configurações → Integrações com o botão **Importar leads agora**. Sem liberação do master, o card não aparece.
3. A importação é manual: ao clicar, o app busca os leads do Municipal Connect Pro, deduplica (por identificador de origem, e-mail e telefone) e insere os novos em Leads, marcando origem `municipal_connect`.
4. Na tela de Leads, a coluna **Cidade** aparece somente quando a empresa tem a integração ativa. O campo `city` já existe na tabela de leads e será preenchido pela importação.

## Acesso aos dados do Municipal Connect Pro

O Municipal Connect Pro é outro projeto Lovable, ou seja, outro banco. O Leaderei não consegue ler as tabelas dele diretamente por SQL — o acesso é feito por HTTP com credenciais de serviço.

Precisarei de dois segredos (peço no momento da implementação):
- `MCP_SUPABASE_URL` — URL do backend do Municipal Connect Pro
- `MCP_SERVICE_ROLE_KEY` — chave de serviço daquele projeto (fica só no servidor, nunca no navegador)

Se você preferir não expor a chave de serviço, a alternativa é criar no Municipal Connect Pro uma função pública protegida por token que devolva os leads — mesmo fluxo aqui, só muda a credencial.

Também preciso saber o nome da tabela de leads/contatos de lá e quais campos representam nome, e-mail, telefone, cidade e município. Se não souber de cabeça, faço uma leitura exploratória assim que os segredos existirem e confirmo o mapeamento antes de importar.

## Detalhes técnicos

**Banco (migração)**
- Nova tabela `municipal_integrations`: `company_id` (única), `enabled`, `municipality_key`, `source_config` (jsonb), `last_sync_at`, `last_sync_count`, `last_error`, timestamps.
- GRANTs: `SELECT` para `authenticated`, `ALL` para `service_role`. RLS: membros da empresa leem a sua linha; escrita apenas por master admin (`has_role`) ou service_role.
- `leads`: adicionar `municipal_source_id text` + índice único parcial `(company_id, municipal_source_id)` para dedupe idempotente. `city` já existe.

**Edge functions**
- `municipal-import`: valida sessão, exige membro da empresa e integração habilitada, busca leads no Municipal Connect Pro em páginas, mapeia campos (incluindo `city`), deduplica e insere; grava `last_sync_at`, `last_sync_count`, `last_error` e um registro em `audit_logs`. Retorna `{ created, updated, skipped }`.
- `municipal-admin-toggle`: só master admin; cria/atualiza a linha em `municipal_integrations`.

**Frontend**
- `src/hooks/useMunicipalIntegration.ts`: lê o status da empresa atual e expõe a mutation de importar.
- `src/pages/master/Companies.tsx`: coluna/ação Municipal Connect Pro com switch e último sync.
- `src/pages/settings/Integrations.tsx`: card condicional com botão "Importar leads agora" e resumo do último resultado.
- `src/pages/Leads.tsx`: coluna "Cidade" renderizada apenas quando a integração está ativa.

**Versão**: bump para `beta 0.28`.
