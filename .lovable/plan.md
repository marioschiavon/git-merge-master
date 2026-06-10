## Objetivo

No fluxo de enriquecimento já existente (`enrich-lead`), além de descobrir redes sociais e analisar o site, **preencher dados faltantes do lead** (email, telefone, WhatsApp) quando forem encontrados no website ou nas redes sociais. Garantir também que o scraping do site sempre rode quando houver `website`, e que site + Instagram + demais redes alimentem a geração da mensagem personalizada.

## Mudanças

### 1. Extração de contatos no website (`enrich-lead`)
Novo helper `extractContacts(html)` que detecta:
- **Emails**: regex padrão, filtrando `noreply@`, `wordpress@`, imagens (`.png@`), e priorizando emails do mesmo domínio do site.
- **Telefones BR**: regex para formatos `+55 (11) 9xxxx-xxxx`, `(11) 9xxxx-xxxx`, `11 9xxxx xxxx`, números puros de 10–13 dígitos. Normaliza para E.164 (`+55...`).
- **WhatsApp**: links `wa.me/<num>`, `api.whatsapp.com/send?phone=<num>`, `whatsapp://send?phone=<num>` — extrai e normaliza para E.164.

Roda na mesma etapa que `extractSocials`, usando o HTML já baixado (sem custo extra). Também tenta páginas comuns de contato quando a home não retorna nada: `/contato`, `/contact`, `/fale-conosco` (1 fetch extra, opcional).

### 2. Extração de contatos das redes sociais
Após o scrape via Apify, varrer `bio` e `raw` de cada `lead_social_profiles` (Instagram, Facebook, LinkedIn) procurando email/telefone/WhatsApp no texto da bio e em campos como `businessEmail`, `businessPhoneNumber`, `publicEmail`, `contactPhone`, `websites`/`externalUrl` (que às vezes apontam para wa.me).

### 3. Preenchimento condicional do lead
Atualizar `leads` apenas para campos vazios (não sobrescrever dados do usuário):
- `email` ← se `lead.email` nulo/vazio
- `phone` ← se `lead.phone` nulo/vazio
- `whatsapp` ← se `lead.whatsapp` nulo/vazio; se ainda assim faltar e houver `phone` válido BR celular (9º dígito), copiar `phone` → `whatsapp`
- Preferência: dados do website > Instagram > Facebook > LinkedIn (sites próprios são mais confiáveis).

Registrar em `steps_done.autofill = { email: "website", phone: "instagram_bio", whatsapp: "wa_link" }` para auditoria.

### 4. Garantir scrape do site
Hoje o site só é baixado se `settings.website_analysis` **ou** `settings.discover_socials` estiver ativo. Vamos sempre baixar o HTML quando `lead.website` existir e qualquer uma das flags estiver ligada (incluindo a nova `autofill_contacts`, default `true`). A análise via Gemini continua gated por `website_analysis`.

### 5. Mensagem personalizada
O prompt já inclui insights do site + posts do Instagram. Vamos:
- Reforçar no `system` que, se houver bio/posts do Instagram OU sinais fortes do site, o gancho deve citar isso explicitamente.
- Garantir que `socialSummary` inclua também Facebook/LinkedIn (bio + headline/about) quando presentes — hoje já é genérico, mas vamos truncar melhor para caber tudo.

### 6. Configuração (`EnrichmentSettingsCard`)
Adicionar toggle **"Completar contatos faltantes (email / telefone / WhatsApp)"** → grava `enrichment_settings.autofill_contacts` (default `true` em contas novas; existentes precisam ativar).

### 7. UI — visibilidade
Em `LeadDetail`, quando um campo foi autopreenchido pelo enriquecimento, mostrar um pequeno badge "auto" ao lado (tooltip com a fonte, ex.: "Encontrado no Instagram"). Fonte vem de `lead_enrichment_jobs.steps_done.autofill` do job mais recente.

## Fora de escopo
- Validação/verificação ativa de email (SMTP check, MX lookup).
- Enriquecimento via Hunter, Apollo, ZoomInfo etc.
- Tratamento de múltiplos contatos por lead (sempre 1 email / 1 telefone / 1 whatsapp por enquanto).

## Ordem de implementação
1. `enrich-lead/index.ts`: helpers `extractContacts`, `extractContactsFromSocial`, lógica de autofill e gating do fetch do site.
2. Atualizar prompt de mensagem (mesmo arquivo).
3. `EnrichmentSettingsCard.tsx`: toggle `autofill_contacts`.
4. `LeadDetail.tsx`: badges "auto" usando `steps_done.autofill`.
5. Reprocessar lead de teste e validar.

## Detalhes técnicos
- Sem migration: usamos colunas existentes em `leads` (`email`, `phone`, `whatsapp`) e gravamos a procedência em `lead_enrichment_jobs.steps_done` (já é `jsonb`).
- Normalização de telefone num único helper `normalizePhoneBR(str)` que retorna `+55DDDNUMERO` ou `null`.
- Anti-falso-positivo: ignorar números com menos de 10 dígitos, sequências repetidas (`1111111111`), e telefones que aparecem dentro de scripts de tracking (Google Tag Manager, etc.) descartando blocos `<script>` antes do regex (já feito no `htmlToText`, replicar no `extractContacts`).
