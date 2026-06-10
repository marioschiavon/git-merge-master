## Objetivo
Incluir os dados de análise de redes sociais (Instagram, LinkedIn etc. — tabela `lead_social_profiles`) no contexto usado para gerar mensagens personalizadas, tanto nas **3 variações de "Sugestões de Abordagem"** quanto nos **previews dos steps** em `/cadences`.

## Mudanças

### 1. `supabase/functions/preview-cadence-messages/index.ts`
- Adicionar 1 query extra ao bloco `Promise.all` (linha 87):
  ```ts
  supabase.from("lead_social_profiles")
    .select("network, handle, bio, followers, posts_summary, recent_posts")
    .eq("lead_id", lead_id)
  ```
- Montar `socialContext` (string) logo após `insightsContext`:
  - Para cada perfil: `### {network} (@{handle}) — {followers} seguidores\nBio: {bio}\nResumo de posts: {posts_summary}\nÚltimos posts: {top 3 recent_posts.caption truncados a 200 chars}`
  - Se nenhum perfil tiver bio/posts_summary/recent_posts, deixar vazio.
- Injetar `socialContext` em **dois pontos**:
  - No `variationsSystem` (modo variações — Sugestões de Abordagem), nova seção `=== SINAIS DE REDES SOCIAIS DO PROSPECT ===` logo após `=== INSIGHTS DO PROSPECT ===`.
  - No system prompt do modo padrão (geração por step), mesma seção, controlada pela mesma flag `useInsights` do step (se `smart_customization`/`use_insights` estiver ativo).
- Atualizar regras: "Quando houver sinais de redes sociais, prefira referenciar um post/tema concreto recente em vez de gancho genérico. Nunca invente."

### 2. (Opcional, mesmo arquivo) Logging
- Log curto indicando quantos perfis sociais foram carregados, para debug.

## Fora de escopo
- Sem mudanças de schema.
- Sem mudanças no front (`LeadDetail.tsx`, `CadenceFirstMessageInline.tsx`) — eles já consomem o output desta função.
- Sem alteração em `analyze-lead-website` ou `enrich-lead`.

## Ordem de execução
1. Editar `preview-cadence-messages/index.ts` (query + montagem + injeção nos dois prompts).
2. Deploy automático da function.
3. Validar abrindo um lead com Instagram enriquecido e clicando em "Regenerar".
