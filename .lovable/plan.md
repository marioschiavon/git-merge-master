
# Importação de CSV — paridade com Leaderei Foundation

Objetivo: substituir o `LeadImportDialog` atual (13 campos fixos, sem mapeamento) por um wizard de 3 passos com auto-detecção de encoding/delimitador, mapeamento de colunas e suporte a ~22 campos + campos extras que caem em `enrichment_data`.

## Escopo

Somente frontend/importação e o hook que envia ao backend. Sem mudar schema, sem tocar em `Leads.tsx`, sem mexer em Pipedrive/sync/enriquecimento.

## Mudanças

### 1. `src/components/leads/LeadImportDialog.tsx` (reescrita)

Wizard em 3 steps dentro do mesmo Dialog:

- **Step 1 — Upload**
  - Input de arquivo `.csv`.
  - Parse com `papaparse`: `header: false`, `skipEmptyLines: true`, `delimitersToGuess: [",", ";", "\t", "|"]`, `encoding: "UTF-8"` (fallback tenta `ISO-8859-1` se detectar `\uFFFD` no preview).
  - Renomeia headers vazios (`Coluna 1`, `Coluna 2`…) e duplicados (`nome`, `nome (2)`).
  - Alerta amarelo listando renomeações e possível problema de encoding.

- **Step 2 — Mapeamento**
  - Tabela: coluna do CSV → Select com opções (`Ignorar`, `Outro (enrichment_data)`, e a lista de campos suportados).
  - Auto-sugestão via regex ordenada por especificidade (ex.: `linkedin_company` antes de `linkedin`).
  - Campos suportados: `first_name`, `last_name`, `name`, `email`, `secondary_email`, `personal_email`, `phone`, `mobile_phone`, `corporate_phone`, `whatsapp`, `title`, `seniority`, `department`, `company_name`, `industry`, `employee_count`, `website`, `linkedin_url`, `linkedin_company_url`, `instagram_url`, `facebook_url`, `address`, `city`, `state`, `country`, `tags`, `status`, `source`.
  - Preview das 5 primeiras linhas.
  - Validação bloqueante: exige mapeamento de `name` (ou `first_name`+`last_name`) E pelo menos um de `email`/`phone`/`whatsapp`.

- **Step 3 — Revisão & Importação**
  - Contagem: total de linhas, com nome, com email, com telefone, marcadas para `Outro`.
  - Botão “Importar” chama `useImportLeads` e mostra progresso.
  - Resultado final: `{received, created, skipped, errors[]}` com lista expansível de erros por linha.

Regras de transformação:
- `first_name` + `last_name` → concatena em `name` se `name` não mapeado.
- `tags`: split por `,` ou `;`, trim, remove vazios.
- `employee_count`: parse para número quando possível.
- Campos mapeados como `Outro` → agrupados em `extra: Record<string,string>` e mesclados em `enrichment_data`.

### 2. `src/hooks/useImportLeads.ts` (extensão)

- Estender o tipo `LeadInput` com os novos campos + `extra?: Record<string,string>`.
- No envio: mesclar `extra` dentro de `enrichment_data` (`{ ...existing, csv_import: extra }`).
- Retornar `{received, created, skipped, errors: {row, message}[]}` em vez de contagem simples.
- Manter chamada atual à edge function / insert (não muda contrato do backend).

### 3. Dependência

- Confirmar/instalar `papaparse` + `@types/papaparse` se ainda não estiverem no projeto.

## Fora de escopo

- `Leads.tsx`, schema do banco, triggers de enriquecimento, integrações externas.
- Edge functions (o insert continua pela via atual).

## Detalhes técnicos

```text
LeadImportDialog
├── Step Upload    → papaparse (auto delimiter + encoding fallback)
├── Step Mapping   → auto-suggest regex + Select por coluna
└── Step Review    → chama useImportLeads → mostra {received,created,skipped,errors}
```

Auto-suggest (exemplos de regex, ordem importa):
- `/linkedin.*(company|empresa)/i` → `linkedin_company_url`
- `/linkedin/i` → `linkedin_url`
- `/whats/i` → `whatsapp`
- `/mobile|celular/i` → `mobile_phone`
- `/corporat|comercial/i` → `corporate_phone`
- `/mail.*(secund|2)/i` → `secondary_email`
- `/mail.*(pessoal|personal)/i` → `personal_email`
- `/nome|name/i` → `name`
