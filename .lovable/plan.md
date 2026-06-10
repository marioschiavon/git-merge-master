## Objetivo

Hoje o enriquecimento do Instagram usa `apify/instagram-profile-scraper`, que retorna majoritariamente dados do perfil (bio, seguidores) e pouco do conteúdo postado. Vamos passar a coletar **os últimos posts** para entender de fato sobre o que a empresa fala, e usar isso como contexto na geração da mensagem personalizada.

## Mudanças

### 1. Apify — trocar/combinar actor do Instagram
- Substituir `apify/instagram-profile-scraper` por **`apify/instagram-scraper`** (oficial, suporta `resultsType: "posts"` e `resultsLimit`).
- Input: `{ directUrls: [lead.instagram_url], resultsType: "posts", resultsLimit: 12, addParentData: true }`.
  - `addParentData: true` faz cada post vir com o objeto do owner (bio, seguidores, nome), então mantemos profile + posts em uma única chamada e um único custo.
- Mapeamento na `lead_social_profiles`:
  - `bio`, `followers`, `handle` ← do `ownerUsername`/`owner` no primeiro item (parent data).
  - `recent_posts` ← array normalizado `[{ caption, hashtags, likes, comments, timestamp, url, type }]` (até 12).
  - `raw` ← payload bruto.

### 2. `enrich-lead` — consolidação de posts
- Novo helper `normalizeInstagramPosts(raw)` que extrai `caption`, `hashtags`, `mentions`, `likesCount`, `commentsCount`, `timestamp`, `url` e `type` (image/video/sidecar).
- Salvar resumo textual dos posts (concatenação de captions truncadas) em uma coluna `posts_summary` em `lead_social_profiles` para reuso barato pela geração de mensagem.
- Migration: adicionar coluna `posts_summary text` em `lead_social_profiles` (a coluna `recent_posts jsonb` já existe).

### 3. Geração de mensagem (`generate_message`)
- Incluir no prompt do Gemini os últimos posts (caption + hashtags) além da bio:
  ```text
  [instagram] bio: ...
  [instagram] últimos posts:
  - 2026-05-30: "caption truncada" (#tag1 #tag2)
  - 2026-05-22: ...
  ```
- Atualizar o `system` para pedir que o gancho da mensagem cite tema/post específico quando houver sinal forte no Instagram.

### 4. `LeadSocialCard`
- Quando `network === "instagram"`, listar os 3-5 posts mais recentes (caption truncada + link "Ver post") abaixo da bio, para o usuário ter visibilidade do que alimentou o rascunho.

### 5. Configuração
- Em `EnrichmentSettingsCard`, adicionar sob o toggle do Instagram um campo numérico **"Posts a analisar"** (default 12, min 3, máx 30) salvo em `enrichment_settings.apify_actors.instagram_posts_limit`.
- `enrich-lead` lê esse limite ao montar o input do actor.

## Fora de escopo
- Scraping de comentários dos posts.
- Stories/reels exclusivos (o `instagram-scraper` já cobre reels quando aparecem no feed).
- Mudar Facebook/LinkedIn — só Instagram nesta iteração.

## Ordem de implementação
1. Migration: `posts_summary` em `lead_social_profiles`.
2. `enrich-lead`: novo actor + normalização + prompt da mensagem.
3. UI: posts no `LeadSocialCard` + campo de limite no `EnrichmentSettingsCard`.
4. Reprocessar lead de teste e validar rascunho gerado.
