## Problema

Na ação `create_new_contact` (em `supabase/functions/execute-action/index.ts`, linhas 465-493), quando o SDR cria um novo lead via indicação:

1. **Email vai para o campo `name`** — a linha `name: name || email` faz isso porque `name` é NOT NULL. Quando o lead indicante só dá o e-mail (sem o nome completo da pessoa indicada), o e-mail acaba virando o nome exibido na lista de leads.
2. **Faltam dados da empresa e website** — só copia `company_name` do indicante; não copia `website`, `address`, `linkedin_company_url` (que normalmente são da mesma empresa em indicações internas).

## Correções

### 1. `supabase/functions/execute-action/index.ts` — `create_new_contact`

- **Nome inteligente**: usar `name` se vier; senão derivar do e-mail (parte antes do `@`, capitalizada, ex.: `joao.silva@x.com` → `Joao Silva`); senão usar o telefone formatado; nunca colocar o e-mail bruto no campo nome.
- **Herdar dados do indicante** quando o lead novo não trouxer valor próprio:
  - `company_name` (já existe — manter)
  - `website`
  - `address`
  - `linkedin_company_url`
  - `pipeline_mode` (manter `'agent'` por padrão, igual ao indicante)
- **Permitir override via params** caso o SDR já tenha extraído website/empresa diferentes.
- **Activity log mais claro**: incluir indicador "(via indicação de {nome do indicante})" e os campos copiados.

### 2. `supabase/functions/sdr-agent/index.ts` — tool `create_new_contact`

Atualizar o schema/descrição da tool `n` (e a forma como o LLM a chama) para aceitar opcionalmente `website` e `company_name` quando o lead indicante mencionar.

### 3. Testes

Adicionar caso em `entity-extractor_test.ts` ou um novo `execute-action`-style teste verificando:
- Quando só email é informado → name = derivado do local-part, não o e-mail completo.
- Lead criado herda `website`, `company_name`, `address` do indicante quando params não trazem esses campos.

## Fora de escopo

- Não mexer no fluxo do `policy-engine` (já ajustado na rodada anterior).
- Não alterar tipos do banco — `name` continua NOT NULL.

## Verificação

- `supabase--test_edge_functions` em `execute-action` e `_shared`.
- Deploy de `execute-action` e `sdr-agent`.
- Conferir na UI `/leads` que um novo referral criado mostra o nome correto e os dados da empresa preenchidos.
