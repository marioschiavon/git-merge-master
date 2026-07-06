## Como o fluxo de enriquecimento funciona hoje

`supabase/functions/enrich-lead/index.ts` é o pipeline. Passos, na ordem:

1. **Baixa o HTML do `lead.website`** (necessário para os passos 2 e parte do 3).
2. **`discover_socials`** — regex no HTML para achar Instagram/Facebook/LinkedIn e preencher `instagram_url`, `facebook_url`, `linkedin_url`, `linkedin_company_url` no lead.
3. **`autofill_contacts`** — regex no HTML (e nas páginas `/contato`, `/contact`, …) para extrair `email`, `phone`, `whatsapp`.
4. **`website_analysis`** — chama a Lovable AI (Gemini 2.5 Flash) com o texto do site e grava insights B2B em `lead_insights`.
5. **Apify scrape** — chama os actors ligados em `platform_settings.apify_actors` (hoje ligados: Instagram e LinkedIn pessoal; Facebook e LinkedIn empresa estão desligados). Cada actor só roda se o lead já tiver a URL correspondente. Salva em `lead_social_profiles` (bio, seguidores, últimos posts, contatos extraídos).
6. **Fallback contatos por redes sociais** — usa bio/campos do Instagram para preencher email/telefone/whatsapp se ainda vazios.
7. **`generate_message`** (opcional) — gera mensagem personalizada.

O trigger `enqueue_lead_enrichment` cria o job automaticamente ao inserir o lead, e o botão "Reprocessar" reenfileira manualmente. O cron `enrichment-cron` recupera jobs travados > 10 min.

## O que aconteceu com o lead "Thiago"

O job **rodou e completou em 6s** (`status = completed`, `steps_done = {apify_scrape: "ran 0"}`, sem erro). Motivo de "nada acontecer":

- O lead **não tem `website`, `instagram_url`, `facebook_url`, `linkedin_url` nem `linkedin_company_url`**.
- Sem site → passos 1-4 são pulados.
- Sem URLs sociais → nenhum actor Apify é acionado (`ran 0`).
- Resultado: pipeline não tem o que enriquecer.

A plataforma está OK (Apify habilitado, tokens presentes, actor de Instagram e LinkedIn pessoal ligados). O único bug visível é o de UI já apontado (badge "Enriquecendo…" preso).

## Correções propostas

1. **UI (bug real):** auto-refresh do `enrichment_status` enquanto for `pending`/`processing` — `refetchInterval` condicional (5s) em:
   - `src/pages/Leads.tsx` (query `["leads", …]`)
   - `src/components/LeadDetailContent.tsx` (queries `["lead_enrichment_job", leadId]` e do próprio lead)
   - `src/components/LeadSocialCard.tsx` (query `["lead_social_profiles", leadId]`)

2. **UX (feedback claro):** quando o job completa mas nada foi enriquecido por falta de URLs, mostrar aviso no `LeadSocialCard`/`LeadDetailContent`:
   - Se `steps_done.apify_scrape === "ran 0"` **e** o lead não tem `website`/`instagram_url`/`facebook_url`/`linkedin_url`/`linkedin_company_url`, exibir um alerta:
     _"Nada para enriquecer: adicione ao menos o site ou uma URL de rede social do lead e clique em Reprocessar."_

Nenhuma alteração em edge functions ou banco.
