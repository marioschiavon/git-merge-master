
## Objetivo

Trazer para este app a mesma estrutura de campos que o Leaderei Foundation usa na importação (CSV/Apollo/Pipedrive), promovendo campos hoje "escondidos" no JSON `pipedrive_data.csv_import` a **colunas nativas** da tabela `leads`. Isso permite filtrar, buscar, segmentar e enviar variáveis para IA a partir de `seniority`, `industry`, `city`, `tags` etc.

## 1. Migração do schema (`leads`)

Adicionar (todas nullable, sem quebrar dados existentes):

- `first_name text`, `last_name text`
- `secondary_email text`, `personal_email text`
- `mobile_phone text`, `corporate_phone text`
- `seniority text`, `department text`
- `industry text`, `employee_count integer`
- `city text`, `state text`, `country text`
- `tags text[]` (default `'{}'`)
- `enrichment_data jsonb` (default `'{}'`) — para colunas de CSV desconhecidas

**Sem** duplicatas: mantém-se `name` (não cria `full_name`), `title` (não cria `job_title`), `website` (não cria `website_url`) e `linkedin_company_url` (não cria `company_linkedin_url`). No mapeador do CSV eu aceito os nomes do Foundation e traduzo internamente.

Backfill leve: migrar `pipedrive_data->'csv_import'` de leads já importados para as novas colunas (best-effort, um `UPDATE ... SET` por chave conhecida).

Índices simples em `(company_id, industry)` e `(company_id, seniority)` para filtragens futuras.

## 2. CSV import — `LeadImportDialog` + `useImportLeads`

Substituir a lista `FieldKey` e o mapa `AUTO_SUGGEST` pela versão do Foundation, mais completa e ordenada por especificidade (padrões estilo Apollo/Pipedrive: "First Name", "Company Linkedin Url", "# Employees", "Person Linkedin Url", etc.). Novidades:

- Sentinel `OTHER` ("Guardar como enriquecimento") — coluna vai para `enrichment_data` sob a chave normalizada do cabeçalho, no lugar de virar `extra` em JSON de pipedrive.
- Normalização de URL (`website`, `linkedin_url`, `linkedin_company_url`, `facebook_url`, `instagram_url`).
- Parse robusto de `employee_count` (extrai o primeiro número inteiro, tolera `1.000`, `100+`).
- Composição `name` a partir de `first_name`/`last_name` quando não há `name`.
- Regra de obrigatório: nome + (email OU telefone/whatsapp/mobile/corporate). Continua igual, mas com mais fontes de telefone.

O `useImportLeads` (hook) passa a montar payload com as novas colunas nativas e `enrichment_data` (em vez de `pipedrive_data.csv_import`). Comportamento de chunks/erros/`enrich_limit` fica idêntico.

Modelo do CSV (botão "Baixar modelo") atualizado para o cabeçalho canônico do Foundation, cobrindo os campos Apollo/Pipedrive mais comuns.

## 3. Import Apollo — `apollo-import` + `_shared/apollo.ts`

`mapPersonToLeadPayload` passa a preencher também:

- `first_name`, `last_name`
- `seniority` (de `p.seniority`)
- `department` (join de `p.departments`)
- `industry`, `employee_count` (de `p.organization`)
- `city`, `state`, `country` (nativos, sem perder o `address` composto)

Sem mudança no fluxo de dedup / rate-limit / cache.

## 4. Sync Pipedrive — `pipedrive-sync`

Extrair também para colunas nativas quando o Person do Pipedrive traz:

- `first_name`/`last_name` (se o Pipedrive tiver campos separados; caso contrário, split de `name`)
- `city`, `state`, `country` a partir de `postal_address`
- `industry` (do org, se presente em custom fields — best-effort, sem quebrar)

`pipedrive_data` (JSON bruto) continua guardando a payload original.

## 5. UI

- `LeadDetail` / `LeadDetailContent`: mostrar as novas propriedades quando presentes (cidade/estado/país em uma linha, senioridade + departamento + indústria + tamanho da empresa em um pequeno bloco "Firmográficos"). Sem redesenho — só adição.
- `LeadFormDialog`: adicionar campos opcionais (agrupados num accordion "Detalhes avançados") para permitir edição manual.

## 6. Fora do escopo

- Filtros na página `/leads` por indústria/senioridade/cidade (fica para depois).
- Score que usa esses campos.
- Mudanças em cadências / IA para consumir os novos campos como variáveis (fica para próximo pedido).

## Detalhes técnicos

- Migração em uma única transação, todos os `ADD COLUMN IF NOT EXISTS`.
- Backfill idempotente: só copia do JSON quando o campo nativo está NULL.
- Nenhum GRANT novo é necessário (a tabela `leads` já tem GRANT).
- Regenerar `src/integrations/supabase/types.ts` acontece automaticamente após a migration.
