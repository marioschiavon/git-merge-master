# Problema

Quando uma indicação é criada via `inbound-webhook` (branch `referral.with_contact`), só copiamos `company_name` do lead que indicou. No caso da Jakeline (Revivere):

- Indicador (`d8132c02…`): `company_name = NULL`, `website = https://revivere.com.br`
- Indicado (`f15defca…`): `company_name = NULL`, `website = NULL`

Como o `company_name` do indicador estava vazio, nada foi para o indicado — apesar de o website deixar claro que é a mesma empresa.

# Correção

## 1. `supabase/functions/inbound-webhook/index.ts` (branch `with_contact`, ~linha 1436)

Ao montar o `insertRow` do lead indicado, copiar do `leadData` (indicador) **todos** os campos de empresa que existirem:

- `company_name`
- `website`
- `address`
- `linkedin_company_url`

Aplicar o mesmo `patch` no caminho de update (`if (existing)`, ~linha 1418-1431): preencher esses campos se o indicado existente estiver com eles `null` (não sobrescrever valores já existentes).

Derivar `company_name` a partir do domínio do website como fallback (ex.: `revivere.com.br` → `Revivere`) **apenas** se o indicador também não tiver `company_name`. Lógica simples: pegar o primeiro rótulo do domínio, capitalizar.

## 2. One-shot para o lead da Jakeline já criado

Para `f15defca-27c2-4be3-a284-0cccb53a006d`, fazer um `UPDATE` preenchendo:

- `company_name = 'Revivere'`
- `website = 'https://revivere.com.br'`
- `address`, `linkedin_company_url` se o indicador tiver (atualmente não tem).

Opcionalmente, atualizar também o próprio indicador (`d8132c02…`) com `company_name = 'Revivere'` para que indicações futuras já saiam corretas.

## 3. Disparar enriquecimento do indicado

Depois do update, o trigger `enqueue_lead_enrichment` só roda em `INSERT`. Vamos enfileirar manualmente via `INSERT INTO lead_enrichment_jobs` para que o enrichment pegue o website e complete o resto (segmento, socials, etc.), respeitando o `enrichment_settings` da empresa.

# Fora de escopo

- Mudar o prompt da IA para tentar extrair empresa do contexto (a IA já tem `referred_company` opcional, mas o problema atual é só propagar o que já temos).
- Backfill retroativo de outros leads indicados antigos.

# Detalhes técnicos

- O helper de domínio pode viver inline no `inbound-webhook` (função pequena, sem precisar mover para `_shared`).
- Manter `company_name` `null` se nem website nem company_name do indicador existirem (não inventar).
- No update do `existing`, usar `COALESCE`-style: só preencher quando o campo atual for `null`/vazio.
