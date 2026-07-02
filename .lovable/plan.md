# Seleção centralizada dos actors do Apify

Hoje os IDs dos actors do Apify estão **hardcoded** dentro de `enrich-lead/index.ts` (`apify/instagram-scraper`, `apify/facebook-pages-scraper`, `dev_fusion/linkedin-profile-scraper`, `apimaestro/linkedin-company`). Isso significa que trocar um actor exige alterar código. A empresa continua escolhendo apenas **quais redes** usar; **qual actor** rodar em cada rede é decisão global do master admin.

## 1. Extender `platform_settings`

Adicionar uma coluna `apify_actors JSONB` (default com os valores atuais) que guarda, para cada rede, o actor ativo:

```json
{
  "instagram":        { "actor_id": "apify/instagram-scraper",           "enabled": true },
  "facebook":         { "actor_id": "apify/facebook-pages-scraper",      "enabled": true },
  "linkedin_person":  { "actor_id": "dev_fusion/linkedin-profile-scraper","enabled": true },
  "linkedin_company": { "actor_id": "apimaestro/linkedin-company",       "enabled": true }
}
```

Só o master admin lê/escreve (RLS já garante isso na tabela singleton).

## 2. UI em `/master/platform-settings`

Novo bloco dentro do card "Apify — Scraping de redes sociais": uma seção **"Actors por rede"** com 4 linhas (Instagram, Facebook, LinkedIn Pessoa, LinkedIn Empresa). Cada linha tem:

- Toggle "Habilitar essa rede globalmente"
- Input de texto com o **Actor ID** (formato `owner/actor-name`), pré-preenchido com o default
- Link "Buscar actors no Apify Store →"
- Botão pequeno "Restaurar padrão"

Um único botão "Salvar" persiste `apify_enabled` + `apify_actors` de uma vez.

Se um actor global estiver desabilitado, o toggle correspondente da empresa (em `EnrichmentSettingsCard`) fica sem efeito para aquela rede — o enrich pula.

## 3. Refatorar `enrich-lead/index.ts`

- Ler `platform_settings.apify_actors` uma vez por execução (mesma query que já lê `apify_enabled`).
- Substituir os 4 literais `"apify/instagram-scraper"` etc. por `platformActors.instagram.actor_id` etc.
- Fallback: se a coluna vier vazia/nula, usar os defaults hardcoded (mantém retrocompatibilidade).
- A condição de rodar cada actor vira: `platformActor.enabled !== false && company.actors.<network> !== false && lead.<url>`.

## 4. Documentar defaults e formato

Comentar no card do master que:
- Actor ID segue o formato `owner/name` do Apify Store.
- O token global (`APIFY_API_TOKEN`) precisa ter permissão de rodar o actor escolhido.
- Trocar o actor afeta imediatamente todas as próximas execuções.

## Detalhes técnicos

- Migração: `ALTER TABLE platform_settings ADD COLUMN apify_actors JSONB NOT NULL DEFAULT '{...}';` com o JSON dos 4 defaults atuais.
- Sem mudança de RLS (a política existente cobre a coluna nova).
- Frontend: estender o `useState` de `PlatformSettings.tsx` para incluir `apify_actors`; adicionar componente `<ActorRow network label defaultId />` reaproveitável.
- Edge function: apenas 4 substituições de string + uma leitura extra do select.

## Fora do escopo

- Configurar **parâmetros por actor** (ex.: `resultsLimit` do Instagram já é por-empresa, mantém como está).
- Suportar múltiplos actors alternativos por rede com fallback.
- Actors adicionais (TikTok, YouTube, etc.) — adicionar depois é só estender o JSON.
