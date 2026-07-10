# Trocar LinkedIn (pessoa) para `harvestapi/linkedin-profile-scraper`

## Mudanças de código

1. **`src/pages/master/PlatformSettings.tsx`** (linha 280 do bloco `DEFAULT_ACTORS`)
   - `linkedin_person.actor_id`: `dev_fusion/linkedin-profile-scraper` → `harvestapi/linkedin-profile-scraper`

2. **`supabase/functions/enrich-lead/index.ts`** (linha 280 do bloco `DEFAULT_ACTORS` interno)
   - Mesmo swap do default.
   - Linha 404: input do actor passa a incluir os dois formatos aceitos pelo harvestapi para máxima compatibilidade:
     ```ts
     { profileScraperMode: "Full", queries: [lead.linkedin_url], profileUrls: [lead.linkedin_url] }
     ```

3. **Parser (`upsertProfile`, linha 358)** — já cobre o output do harvestapi:
   - `bio` lê `biography || description || about` → harvestapi retorna `about` ✅
   - `followers` lê `followersCount || followers` → harvestapi retorna `followers` (number) ✅
   - Sem mudança necessária no mapeamento.

## Migração dos tenants existentes

Empresas que já salvaram `platform_settings.apify_actors` com o valor antigo continuarão usando `dev_fusion/…`. Rodar migration única para atualizar o JSON quando ainda estiver no default antigo:

```sql
UPDATE public.platform_settings
SET apify_actors = jsonb_set(
  apify_actors,
  '{linkedin_person,actor_id}',
  '"harvestapi/linkedin-profile-scraper"'
)
WHERE apify_actors->'linkedin_person'->>'actor_id' = 'dev_fusion/linkedin-profile-scraper';
```

## Deploy e validação

1. Redeploy `enrich-lead`.
2. Em **Master → Platform Settings** confirmar que LinkedIn (pessoa) mostra o novo default.
3. Smoke test: reprocessar 1 lead com `linkedin_url` e conferir em `lead_social_profiles` (network=`linkedin_person`) que `bio`, `followers` e `raw` foram preenchidos.

Nada muda para Instagram/Facebook/LinkedIn empresa.
