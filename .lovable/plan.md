

## Adicionar Website e Endereço aos Leads (Pipedrive)

### Problema
A tabela `leads` não possui colunas para website e endereço. O sync do Pipedrive ignora esses campos mesmo quando disponíveis na API.

### Solução

**1. Migration — adicionar colunas à tabela `leads`**
```sql
ALTER TABLE leads ADD COLUMN website text;
ALTER TABLE leads ADD COLUMN address text;
```

**2. Atualizar `pipedrive-sync/index.ts`**
Extrair do objeto `person` do Pipedrive:
- `person.org_id?.cc_email` ou dados da org para website (campo customizado ou `person.org?.address`)
- Pipedrive armazena endereço em `person.postal_address` (ou `person.address`) como string formatada

Adicionar no upsert:
```ts
website: person.org?.cc_email || null,  // ou campo custom
address: person.postal_address || person.address || null,
```

Como o Pipedrive pode armazenar website como campo custom ou na organização, vamos também salvar de `pipedrive_data` e buscar campos comuns.

**3. Atualizar UI — `Leads.tsx`**
Adicionar coluna "Website" na tabela de leads.

**4. Atualizar UI — `LeadDetail.tsx`**
Mostrar website (com link clicável) e endereço no painel de detalhes.

**5. Deploy da edge function `pipedrive-sync`**

### Campos do Pipedrive
Na API de Persons do Pipedrive:
- **Website**: Não é campo nativo de Person — geralmente está na Organization (`org_id.address`) ou como campo customizado. Vamos buscar primeiro em `person.org_name` related org data. Uma alternativa é buscar o campo da Organization separadamente.
- **Endereço**: `person.postal_address` (string) disponível na API v1.

### Nota
Se o website não estiver no objeto `person` direto, precisaremos fazer uma chamada extra à API de Organizations do Pipedrive para buscar o website da empresa vinculada. Isso será avaliado durante a implementação.

