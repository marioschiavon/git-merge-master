# Apify 100% global — remover configuração por empresa

Hoje a empresa ainda vê no `EnrichmentSettingsCard` um toggle "Scraping avançado de redes sociais" e uma sub-seção "Redes habilitadas" (Instagram / Facebook / LinkedIn pessoa / LinkedIn empresa) + limite de posts do Instagram. Isso conflita com a decisão: **Apify é um recurso da plataforma; empresas não configuram nada.**

## 1. `EnrichmentSettingsCard.tsx`

Remover completamente:
- Toggle `apify_scrape`
- Bloco condicional "Redes habilitadas" (`apify_actors.instagram/facebook/linkedin_person/linkedin_company`)
- Input `instagram_posts_limit`

O que fica no card da empresa:
- `website_analysis`
- `discover_socials`
- `autofill_contacts`
- `validate_whatsapp`
- `generate_message` + `default_cadence_id`

Adicionar uma linha informativa neutra logo abaixo do `discover_socials`:
> "O enriquecimento de redes sociais (Instagram, Facebook, LinkedIn) é executado automaticamente pela plataforma quando disponível — nenhuma configuração necessária."

## 2. `enrich-lead/index.ts`

O gating do Apify passa a depender **só** de:
- `platform_settings.apify_enabled = true`
- `APIFY_API_TOKEN` presente
- Actor da rede com `enabled: true` no `platform_settings.apify_actors`
- Lead ter o `<rede>_url` correspondente

Remover as verificações `settings.apify_scrape` e `settings.apify_actors.<rede>` (config por empresa). O `instagram_posts_limit` vira uma constante interna (12) — se no futuro o master quiser expor, entra no `platform_settings`.

O trigger `enqueue_lead_enrichment` no banco continua igual: já enfileira quando qualquer dos outros toggles da empresa está ligado; o Apify pega carona no mesmo job automaticamente, sem depender de `apify_scrape`.

## 3. Migração leve nas empresas existentes

Não é necessário migrar dados — o edge function passa a ignorar `enrichment_settings.apify_*`. Deixamos os campos antigos como lixo inócuo no JSON; não removemos por não haver custo.

## Detalhes técnicos

- Sem mudança de schema.
- Sem mudança em `PlatformSettings.tsx` (a UI global já está pronta).
- Frontend: 1 arquivo (`EnrichmentSettingsCard.tsx`).
- Backend: 1 arquivo (`enrich-lead/index.ts`) — remover 2 condições e o bloco de `actors.instagram_posts_limit`.

## Fora do escopo

- Expor limite de posts do Instagram no painel do master (posso adicionar depois se pedir).
- Métricas/quotas por empresa sobre o uso do recurso global.
