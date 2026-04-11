

## Fix: Buscar Website da Organização no Pipedrive

### Problema
O campo `website` no Pipedrive é armazenado no objeto **Organization**, não no objeto **Person**. Quando a API de Persons retorna `person.org_id`, ela inclui apenas dados básicos da organização (nome, endereço, etc.) — **não inclui campos customizados nem o campo `website`** da organização.

O código atual tenta extrair o website de `person.org_id`, mas esse objeto não contém a informação.

### Solução

Atualizar `supabase/functions/pipedrive-sync/index.ts`:

1. **Buscar todas as Organizations separadamente** — adicionar função `fetchAllOrganizations(apiToken)` que pagina pela API `/v1/organizations` e retorna todas as orgs
2. **Criar um mapa de org_id → org data** para lookup rápido
3. **Para cada person**, buscar a org correspondente no mapa e extrair:
   - `org.url` (campo nativo de website no Pipedrive) — no Pipedrive a organização tem um campo direto chamado `url` para website
   - Fallback: buscar em campos customizados por valores que começam com `http://`, `https://`, ou `www.`
4. **Deploy** da edge function

### Detalhe técnico
A API do Pipedrive para Organizations (`/v1/organizations`) retorna campos como:
- `name`, `address`, `cc_email`
- Campos customizados com hash keys (ex: `abc123_website`)
- O campo padrão de website pode variar — geralmente está em um campo custom ou no campo de texto livre

A chamada extra adiciona latência mas é necessária para obter o website.

