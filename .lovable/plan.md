## Problema

1. Na análise do site (ex.: VETNASA / kate spade), as "sugestões de abordagem" são geradas só com base no prospect, sem saber o que **nós** vendemos (shampoos). Resultado: ganchos genéricos ou desconectados.
2. Leads ficam "Enriquecendo…" para sempre. Causa: o `enrich-lead` pode estourar o tempo da edge function (Apify + várias chamadas de IA em série) e morre sem marcar a job como `failed`. A `enrichment-cron` só pega jobs `pending`, então jobs travados em `processing` nunca são retomados, e o lead permanece em `enrichment_status = 'processing'`.

## O que muda

### 1. `analyze-lead-website` — usar conhecimento da nossa empresa
Antes de chamar a IA, carregar da base:
- `company_knowledge` (até 10 docs) — o que vendemos
- `company_knowledge` tipo `highlights` — diferenciais
- `company_knowledge` tipo `ai_instructions` — regras de abordagem

Reescrever o prompt para que a IA receba dois blocos claros:
- **NOSSO PRODUTO/SERVIÇO** (knowledge + highlights + ai_instructions)
- **SITE DO PROSPECT** (HTML extraído)

Pedir à IA que, no campo `oportunidades_abordagem`, **conecte explicitamente** algo concreto do prospect ao que nós vendemos. Se as `ai_instructions` indicarem falta de fit, gerar abordagem neutra ao invés de forçar ligação (mesma lógica já usada em `preview-cadence-messages`). Saída segue o mesmo JSON atual + um campo `fit_score` (low/medium/high) e `fit_reason`.

### 2. `enrich-lead` — não travar mais
- Responder **202** imediatamente e processar em background com `EdgeRuntime.waitUntil(...)`.
- Envolver todo o pipeline num `Promise.race` com timeout total (ex.: 220s). Se estourar, marcar job como `failed` e `enrichment_status = 'failed'` em vez de deixar `processing`.
- Reduzir paralelismo do Apify: chamadas de actors em paralelo via `Promise.allSettled` já existem, mas baixar `timeout=90` → `60` por actor e cortar `instagram_posts_limit` default para 8.
- No início, se a job já estiver `processing` há mais de 10 min, tratar como retry (não duplicar trabalho, apenas continuar).

### 3. `enrichment-cron` — reabilitar jobs zumbis
Antes de buscar `pending`, fazer um update: jobs em `processing` com `updated_at < now() - interval '10 minutes'` voltam para `pending` (e o lead correspondente volta para `pending` também). Assim travados se recuperam sozinhos no próximo ciclo (cron já roda a cada ~minuto).

### 4. Frontend — feedback claro
`LeadDetail.tsx`: se `enrichment_status === 'processing'` há mais de 5 min, mostrar botão "Tentar novamente" que chama `enrich-lead` diretamente (com novo `job_id` pendente) em vez de só "Enriquecendo…" infinito.

## Fora do escopo
- Mudanças no `preview-cadence-messages` (a lógica de mensagem por cadência continua igual).
- Mudanças de schema (sem migration necessária — `lead_enrichment_jobs.updated_at` já existe? Verifico ao implementar; se não, adiciono migration mínima com `updated_at timestamptz default now()` + trigger).

## Ordem de implementação
1. `analyze-lead-website` (corrige o problema visível — contexto da nossa empresa).
2. `enrich-lead` (waitUntil + timeout global + status `failed` garantido).
3. `enrichment-cron` (recuperar jobs zumbis).
4. `LeadDetail.tsx` (botão de retry).

Posso seguir?
