# Project Memory

## Core
SaaS B2B multi-tenant para automação de SDR. Design clean/light estilo HubSpot. Azul primário HSL(215,90%,50%). Inter font.
Lovable Cloud habilitado. Multi-tenant com RLS por company_id.
Idioma do app: Português BR. Perfis: master_admin, company_admin, user.
Integração real com Pipedrive, WhatsApp (Hook7/Z-API), LinkedIn, Cal.com, Twilio.
Email via Resend multi-tenant: cada company configura seu próprio sending domain (1 por company em v1). Reputação isolada por cliente. Tabela `company_email_domains`, edge `send-outbound-email`, inbound via `resend-inbound-webhook`.

## Memories
- [Multi-tenancy](mem://features/multi-tenancy) — companies, user_roles, company_members tables com RLS e security definer functions
- [Design tokens](mem://design/tokens) — Azul primário 215 90% 50%, success/warning tokens, Inter font family
- [SDR Autônomo](mem://features/sdr-autonomo) — Motor de execução automática de cadências com IA, base de conhecimento, webhooks de resposta
- [Cal.com Integration](mem://features/calcom-integration) — Smart scheduling: 2 slots, 2h hold, auto-follow-up com link de agendamento
- [Guia de Prospecção Liderei](docs/guia-liderei-prospeccao.md) — Referência de produto (03/07/2026): KB multi-tenant, score configurável, controle de volume no enriquecimento, qualidade > volume
- [Manual do Usuário](docs/manual/README.md) — Passo a passo por menu na ordem de onboarding (PT-BR)
- [P01 features](mem://features/p01) — Bulk actions em /leads, kickoff KB protegido, historical_wins, resumos IA de LinkedIn/Instagram em lead_insights
