# Plano de teste dos P0 usando a company do usuário logado

Vou rodar teste end-to-end nos dois P0 aproveitando a sessão atual da preview.

## P0 #1 — Score configurável por cliente

1. Descobrir `company_id` do usuário logado via `psql`.
2. **Migration curta** para preencher `scoring_prompt`, `scoring_include`, `scoring_exclude` na company de teste com um critério real (ex.: fit para SDR/prospecção B2B, incluir "b2b, saas, comercial", excluir "governo, licitação").
3. Pegar 2 leads com `website` preenchido dessa company via `psql`.
4. Chamar `analyze-lead-website` via `supabase--curl_edge_functions` para cada lead.
5. Ler `lead_insights` resultantes via `psql`:
   - `score` deve ser 0–100.
   - `score_breakdown` deve refletir os critérios do prompt (não só o fallback high/medium/low).
   - `insights.fit_reason` deve mencionar os keywords.
6. Reportar findings (o que funcionou, o que ficou genérico, se o prompt do cliente foi respeitado).

## P0 #2 — Controle de volume no enriquecimento

Sem UI aqui (estou em backend), mas dá pra simular:

1. Contar leads da company e distribuição de `enrichment_status`.
2. Se houver leads não enriquecidos, marcar 5 como `pending` e 10 como `not_queued` via migration curta simulando o comportamento do `LeadImportDialog` com `enrichLimit=5`.
3. Chamar `enrichment-enqueue-more` via curl com `count=3` — deve mover 3 de `not_queued` para `pending`.
4. Conferir contagem final.
5. Reportar se o fluxo funciona.

## O que NÃO vou fazer

- Não vou disparar cadência/WhatsApp real (não tem lead-cobaia).
- Não vou alterar código de app.
- Não vou mexer em nenhuma company que não seja a do usuário logado.

## Riscos

- `analyze-lead-website` gasta créditos de IA (~2 chamadas).
- A migration de teste vai preencher `scoring_prompt` na sua company real — no fim do teste, ofereço reverter para NULL se você preferir.

## Reversibilidade

Todo estado alterado é logado no relatório final e revertível via nova migration se você pedir.

Aprova?
