
# Auto-enriquecimento de leads no cadastro/importação

## Objetivo

Quando um lead é criado (manual, CSV ou Pipedrive), disparar automaticamente:
1. Análise do website (já existe — `analyze-lead-website`).
2. Descoberta de redes sociais ausentes a partir do website.
3. Scraping das redes sociais (Instagram, Facebook, LinkedIn pessoa e empresa) via Apify.
4. Geração de uma mensagem de 1ª abordagem personalizada, salva como rascunho na cadência.

Tudo isso processado em background (fila) para não travar a UI nem estourar custo no import em massa.

---

## Configuração por empresa (Settings → Integrações)

Nova seção "Enriquecimento automático" com:
- Toggle **Analisar website automaticamente**
- Toggle **Buscar redes sociais no website** (preenche IG/LinkedIn/FB se faltarem)
- Toggle **Scraping de redes sociais (Apify)** + campo de API token Apify
- Seleção de quais actors rodar (IG, FB, LinkedIn pessoa, LinkedIn empresa)
- Toggle **Gerar rascunho de mensagem personalizada**
- Campo opcional **Cadência padrão** para anexar o rascunho

Sem nenhum toggle ligado → comportamento atual (manual).

---

## Fluxo end-to-end

```text
Lead criado (manual / CSV / Pipedrive)
        │
        ▼
enqueue lead_enrichment_queue (status=pending)
        │
        ▼  (cron 1min)
enrich-lead worker
        │
        ├── analyze-lead-website  ── lead_insights
        ├── discover-social-links ── atualiza lead.instagram/linkedin/facebook
        ├── apify-social-scrape   ── lead_social_profiles (1 por rede)
        ├── consolidate-insights  ── merge website + redes em lead_insights.insights
        └── generate-first-message ── cadence_custom_messages (status=draft)
        │
        ▼
status=completed | failed (com error_message)
```

UI mostra badge "Enriquecendo…" / "Pronto" / "Falhou" na lista e no detalhe do lead.

---

## Mudanças no produto

### Banco
- `lead_enrichment_jobs` (id, lead_id, company_id, status, steps_done jsonb, error, created_at, updated_at)
- `lead_social_profiles` (id, lead_id, company_id, network[instagram|facebook|linkedin_person|linkedin_company], handle, url, raw jsonb, scraped_at)
- `companies` ganha colunas: `enrichment_settings jsonb` (flags + actors selecionados)
- Secret novo por empresa: `APIFY_TOKEN` (armazenado em `integrations` como hoje fazemos com outras chaves)

### Edge functions (novas)
- `enrich-lead` — orquestrador, lê job da fila e roda os passos conforme settings.
- `discover-social-links` — faz fetch do website, regex para urls de IG/FB/LinkedIn e atualiza o lead se faltavam.
- `apify-social-scrape` — chama Apify Run-Sync API para cada actor selecionado; salva em `lead_social_profiles`.
- `generate-first-message` — usa Lovable AI Gateway com prompt consolidado (insights site + posts/bio redes) e cria `cadence_custom_messages` em status `draft`.
- `enrichment-cron` — a cada minuto pega N jobs pendentes e invoca `enrich-lead`.

### Edge functions (alterações)
- `pipedrive-sync`, `lead-import` (CSV) e o handler de criação manual passam a inserir um job em `lead_enrichment_jobs` quando os toggles da empresa estiverem ligados.

### Frontend
- `Leads` table: coluna de status de enriquecimento + ícone para reenfileirar.
- `LeadDetail`: aba "Redes Sociais" com bio/posts/seguidores; aba "Rascunho de mensagem" com botão "Aprovar e enviar".
- `Settings → Integrações`: nova seção "Enriquecimento automático" (toggles + token Apify + seleção de actors + cadência padrão).
- `LeadImportDialog`: aviso "Os leads serão enriquecidos em background nos próximos minutos".

---

## Detalhes técnicos

### Apify
- Endpoint: `POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token=...`
- Actors: `apify/instagram-profile-scraper`, `apify/facebook-pages-scraper`, `dev_fusion/linkedin-profile-scraper`, `apimaestro/linkedin-company`
- Timeout 60s por actor; falha de um actor não bloqueia os outros.
- Token Apify por empresa (não global) — armazenado criptografado via secrets do Lovable Cloud, referenciado por `integrations.config`.

### Descoberta de redes no website
Regex sobre HTML cru já baixado em `analyze-lead-website` (refatorar para retornar `pageHtml` reaproveitável):
- `instagram.com/<handle>`, `facebook.com/<page>`, `linkedin.com/in/<slug>`, `linkedin.com/company/<slug>`

### Geração de mensagem
- Modelo: `google/gemini-2.5-flash` via Lovable AI Gateway (sem chave extra).
- Input consolidado: insights do site + bio/últimos 3 posts de cada rede + nome/empresa/cargo.
- Output JSON: `{ subject, message, hook_used, sources: ["website","instagram",...] }`.
- Persistido em `cadence_custom_messages` com `status='draft'` e `origin='auto_enrichment'`.

### Fila / controle de custo
- `enrichment-cron` processa lote de 5 jobs/min (configurável).
- Retry exponencial até 3 tentativas; depois `failed`.
- Botão "Reprocessar" no LeadDetail reenfileira o job.

### Segurança
- RLS em todas as novas tabelas por `company_id` usando `get_user_company_id` + `has_role`.
- GRANTs explícitos no mesmo migration (SELECT/INSERT/UPDATE/DELETE para `authenticated`, `ALL` para `service_role`).
- Token Apify nunca exposto ao frontend.

---

## Fora de escopo

- Substituição do Twilio (decisão ainda aberta).
- Envio automático da mensagem gerada — fica sempre como rascunho aprovado por humano.
- Re-enriquecimento periódico (só roda no cadastro; reprocesso manual via botão).

---

## Ordem de implementação

1. Migration: tabelas + colunas + GRANTs + RLS.
2. Configuração na empresa (UI + integration row para token Apify).
3. Edge functions: `discover-social-links`, `apify-social-scrape`, `generate-first-message`, `enrich-lead`, `enrichment-cron`.
4. Hooks de criação de lead (manual, CSV, Pipedrive) para enfileirar.
5. UI: status na lista, abas no detalhe, aviso no import.
6. Teste end-to-end com 1 lead real (Eduardo Mattos).
