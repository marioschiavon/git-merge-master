# P01 — Melhorias antes do manual

Executar as 4 melhorias listadas e, ao final, gerar o manual em `docs/manual/` refletindo o comportamento novo. Idioma PT-BR, sem screenshots.

---

## 1. Revisão em massa antes da cadência (P1)

**Objetivo:** permitir triar dezenas de leads enriquecidos por score antes de disparar cadência — reforça o princípio "qualidade > volume" do guia Liderei.

**Backend**
- Nenhuma tabela nova. Usa colunas existentes em `leads` (`score`, `enrichment_status`, `lead_list_id`).
- Nova edge function `leads-bulk-action` recebendo `{ lead_ids[], action: "enroll" | "discard", cadence_id? }`, valida `company_id` via `get_user_company_id`, insere em `cadence_enrollments` (status `active`, `first_message_status='pending_generation'`) ou marca leads como `status='discarded'`.

**Frontend (`src/pages/Leads.tsx`)**
- Novo filtro "Score mínimo" (slider 0–100) + filtro "Somente enriquecidos" + filtro por lista.
- Coluna de checkbox por linha + checkbox master.
- Barra de ações em lote quando ≥1 selecionado: **Enviar para cadência…** (abre `Select` com cadências ativas) e **Descartar**.
- Hook `useBulkLeadActions` (react-query mutation) que chama a edge function e invalida `["leads"]` + `["cadence-enrollments"]`.

## 2. Scraping de LinkedIn e Instagram no enriquecimento (P1)

**Objetivo:** enriquecer com dados sociais que hoje só vêm do site.

**Secret:** `APIFY_API_TOKEN` já existe. Reutilizar.

**Backend**
- Novo helper `supabase/functions/_shared/apify-social.ts` com `fetchLinkedIn(url)` e `fetchInstagram(url)` chamando actors públicos do Apify via REST síncrona (`run-sync-get-dataset-items`), com timeout de 45 s e `try/catch` — retorna `null` em falha (fallback grácil).
- Editar `supabase/functions/enrich-lead/index.ts`:
  - Após a etapa de site, se `settings.discover_socials` e URLs presentes, chamar os dois helpers em paralelo.
  - Resumir cada retorno com `ai-gateway` (`gemini-2.5-flash`) em ~600 chars.
  - Fazer `upsert` em `lead_insights` com colunas novas `linkedin_summary text` e `instagram_summary text` (adicionadas na migração abaixo).
- Se `APIFY_API_TOKEN` ausente ou provider retornar erro, log + segue (não falha o job).

**Migração**
- `ALTER TABLE public.lead_insights ADD COLUMN IF NOT EXISTS linkedin_summary text, ADD COLUMN IF NOT EXISTS instagram_summary text;`

**Frontend**
- `LeadSocialCard.tsx` renderiza os dois resumos quando presentes.
- Prompts em `build-first-message.ts` / `cadence-agent-decide` passam a incluir os dois campos no contexto.

## 3. Base de Conhecimento de kickoff protegida (P2)

**Objetivo:** o cliente vê a KB de kickoff mas não pode editá-la; só admin da Liderei (master_admin) pode.

**Migração**
- `ALTER TABLE public.company_knowledge ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'client' CHECK (origin IN ('kickoff','client','admin')), ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;`
- Substituir policies de UPDATE/DELETE de `company_knowledge`:
  - Permitir se `has_role(auth.uid(),'master_admin')` **OU** (`get_user_company_id(auth.uid())=company_id` **AND** `origin <> 'kickoff'` **AND** `locked = false`).

**Backend**
- Nova edge function `knowledge-import-kickoff` recebendo `{ transcript: string, title?: string }`. Roda `extract-knowledge` interno (chunking + resumo via ai-gateway) e insere em `company_knowledge` com `origin='kickoff', locked=true`.

**Frontend (`src/pages/Knowledge.tsx`)**
- Badge "Kickoff (protegido)" em itens `origin='kickoff'`.
- Botão "Colar transcrição de kickoff" (dialog textarea → chama a edge function). Visível apenas para master_admin **ou** quando a empresa ainda não tem itens de kickoff (para permitir o upload inicial pelo próprio company_admin no onboarding — reduz fricção).
- Bloquear botões Editar/Excluir no card quando `locked=true` e o usuário não for master_admin.

## 4. Alimentar KB comercial com "o que funcionou" (P2)

**Objetivo:** injetar aprendizados históricos nas gerações de mensagem.

**Migração**
- `ALTER TABLE public.company_knowledge ADD COLUMN IF NOT EXISTS knowledge_type text NOT NULL DEFAULT 'general';` (valores permitidos livres, mas usaremos `general`, `kickoff`, `historical_wins`).

**Backend**
- Nova edge function `analyze-historical-wins` (rodada por cron diário via `pg_cron` + `pg_net`, agendada com `insert` — não migração). Para cada `company_id`:
  1. Selecionar cadências com ≥5 enrollments encerrados e `booking_rate` (bookings/enrollments) no top 20 %.
  2. Coletar até 20 primeiras mensagens dessas cadências que resultaram em booking.
  3. Chamar ai-gateway (`gemini-2.5-flash`) com prompt "Resuma em bullets padrões de abordagem que funcionaram (tom, ganchos, CTAs)".
  4. Upsert único por company em `company_knowledge` com `knowledge_type='historical_wins'`, `origin='admin'`, `locked=true`, `title='Aprendizados de cadências vencedoras'`.
- Editar `build-first-message.ts` e `cadence-agent-decide/index.ts`: quando montar contexto, se existir item `knowledge_type='historical_wins'`, incluí-lo em bloco separado do prompt (`## O que funcionou historicamente`).

**Segurança:** função com `verify_jwt=false`, mas valida secret `HOOK7_WEBHOOK_SECRET`-style próprio (`CRON_SECRET`) via header. Se secret ainda não existir, `add_secret` (gerado).

---

## 5. Manual do usuário (após os itens acima)

Criar `docs/manual/` com os arquivos abaixo, refletindo as mudanças do P01. Cada arquivo tem: **O que é**, **Passo a passo**, **Dicas**, **Erros comuns**, **Próximo passo**.

```text
docs/manual/
├── README.md
├── 00-primeiros-passos.md
├── 01-configuracoes-gerais.md              # /settings
├── 02-equipe.md                            # /settings/team
├── 03-integracoes.md                       # /settings/integrations
├── 03a-whatsapp-hook7.md
├── 03b-email-resend.md                     # wizard novo + DNS
├── 03c-apollo.md
├── 03d-pipedrive.md
├── 03e-calcom.md                           # /settings/calcom
├── 04-base-de-conhecimento.md              # inclui kickoff protegido + historical_wins
├── 05-scripts-ia.md
├── 06-intents-acoes.md                     # /settings/intents
├── 07-buscar-apollo.md                     # /apollo
├── 08-leads.md                             # inclui filtro por score + ações em lote (P01#1)
├── 09-listas.md                            # /leads/lists
├── 10-cadencias.md
├── 11-aprovacoes.md
├── 12-acompanhamento.md                    # /cadences/dashboard
├── 13-conversas.md
├── 14-inbox-humana.md
├── 15-anotacoes.md
├── 16-reunioes.md                          # /bookings
├── 17-dashboard.md
├── 18-relatorios.md
└── 19-runs-do-agente.md
```

---

## Ordem de execução

1. Migrações (itens 2, 3, 4 juntas).
2. Backend: helpers + edge functions novas + edições em `enrich-lead`, `build-first-message`, `cadence-agent-decide`.
3. Frontend: `Leads.tsx` (bulk), `Knowledge.tsx` (kickoff), `LeadSocialCard.tsx` (socials).
4. Cron `analyze-historical-wins` (agendado via insert SQL após deploy).
5. Escrever manual em `docs/manual/` refletindo o comportamento final.

## Fora do escopo

- Interpretação de imagens do site (mencionado no guia como melhoria futura).
- Onboarding self-service — mantido acompanhado pela equipe Liderei.
- Screenshots no manual.
