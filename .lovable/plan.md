## Objetivo

No painel **"Sugestões de Abordagem"** (do LeadDetail), substituir as 3 sugestões geradas pelo `analyze-lead-website` por 3 variações da **mesma mensagem do Step 1** da cadência — usando exatamente a mesma lógica do `preview-cadence-messages` (template do step + knowledge + highlights + ai_instructions + insights + mental triggers).

## Por quê

Hoje as sugestões saem da análise do site e ficam desconectadas do template/tom da cadência. O usuário quer que as sugestões reflitam o e-mail real do Step 1 — só variando o ângulo/gancho.

## Mudanças

### 1. `preview-cadence-messages` — novo modo `variations`

Aceitar `{ cadence_id, lead_id, variations: 3 }`. Quando `variations` for passado:

- Pega só o Step 1 (igual ao `only_first_step`).
- Em vez de 1 chamada à IA, faz 1 chamada pedindo um array com N variações:
  ```
  Responda APENAS JSON: { "variations": [
    { "subject": "...", "message": "...", "angle": "gancho usado" }
  ] }
  ```
- Mesmo system prompt já existente (knowledge + highlights + insights + ai_instructions + canal/regras), apenas o user prompt pede "gere 3 variações distintas — ganchos diferentes, todos conectando algo do prospect com o que NÓS vendemos".
- Retorna `{ variations: [...] , step: {channel, subject, template}, lead }`.

### 2. Novo hook `useApproachSuggestions(leadId)`

- Descobre `default_cadence_id` em `companies.enrichment_settings` (fallback: primeira cadência ativa da empresa).
- Chama `preview-cadence-messages` com `variations: 3, only_first_step: true`.
- Cache de 1h (igual ao `useFirstStepPreview`).

### 3. UI — `LeadDetail.tsx` "Sugestões de Abordagem"

- Remove leitura de `insights.oportunidades_abordagem`.
- Renderiza as 3 variações vindas do hook, mantendo o visual atual (card com gancho em negrito + mensagem em itálico).
- Cabeçalho do card mostra "Variações do Step 1 — {cadence_name}" e um botão "Regenerar" (force_regenerate).
- Loading skeleton enquanto carrega. Empty state se não houver cadência configurada → CTA "Definir cadência padrão".

### 4. `analyze-lead-website`

Pode continuar gerando `oportunidades_abordagem` no JSON (útil internamente / em insights), mas a UI não usa mais esse campo nesse painel. Sem alteração nessa função.

## Fora do escopo

- Não mexer no preview do Cadence Leads tab (`CadenceFirstMessageInline`) — continua igual.
- Sem mudança de schema.

## Ordem

1. `preview-cadence-messages` (modo variations).
2. `useApproachSuggestions` hook.
3. `LeadDetail.tsx` (trocar fonte do painel + regenerar).

Confirma?