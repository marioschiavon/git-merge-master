## Opinião

Concordo 100%. Hoje a IA agêntica gera a 1ª mensagem do zero, ignorando o pipeline que já temos (instruções da empresa, highlights, knowledge, insights do site do lead, sinais de redes sociais, gatilhos mentais, estrutura HOOK→CONEXÃO→CTA). Isso é desperdício e gera inconsistência de tom entre cadências estáticas e inteligentes.

A proposta: **a 1ª mensagem da Cadência Inteligente é gerada pela mesma engine do `preview-cadence-messages`** (apenas sem depender de `cadence_steps`). A partir do 2º toque, a IA decide canal/mensagem/quando parar normalmente, mas considerando o histórico da 1ª como contexto.

## Mudanças

### 1. Extrair "build first message" para helper compartilhado
Criar `supabase/functions/_shared/build-first-message.ts` com a lógica de prompt que hoje vive em `preview-cadence-messages/index.ts` (linhas ~86–352).

Assinatura:
```ts
buildFirstMessage({
  supabase, companyId, lead, channel,
  tone,            // policy.tone_instructions
  goal,            // policy.goal
  useHighlights = true,
  useMentalTriggers = false,
  mentalTriggers = [],
})
→ { subject: string|null, message: string }
```

Internamente ela faz exatamente o que já está no preview hoje:
- Busca `company_knowledge` (regular + highlights + ai_instructions)
- Busca `lead_insights` + `lead_social_profiles`
- Monta o system prompt idêntico ao atual (HOOK→CONEXÃO→CTA, regras por canal, instruções obrigatórias da empresa em prioridade máxima, etc.)
- Substitui "TEMPLATE BASE DO STEP" por uma seção **"TOM / INSTRUÇÕES DA CADÊNCIA"** alimentada pelo `tone` da política (quando vier da agêntica) — para estáticas continua usando o template do step.
- Substitui "STEP X de N" por "PRIMEIRO CONTATO".

`preview-cadence-messages` passa a importar esse helper para o caso de step 1 (refatoração sem mudança de comportamento perceptível).

### 2. `cadence-agent-decide`: usar o helper no 1º toque
Em `supabase/functions/cadence-agent-decide/index.ts`, antes da chamada do LLM de decisão:

- Detectar **se é o primeiro envio** (sem decisões prévias de `send` para esse enrollment, ou `attempt_count === 0`).
- Se sim:
  1. Calcular `effectiveChannel` (já existe — whatsapp se lead tem; senão email).
  2. Chamar `buildFirstMessage({ ..., channel: effectiveChannel, tone: policy.tone_instructions, goal: policy.goal })`.
  3. Registrar a decisão como `action: "send"`, `channel: effectiveChannel`, `rationale: "Primeira mensagem usando engine padrão (knowledge + insights + tom da política)"`, com `subject/message` retornados.
  4. Enviar via Z-API/Gmail (mesma rota atual).
  5. Reagendar próximo tick (ex.: +2 dias úteis).
  6. **Não chamar o LLM agêntico ainda.**
- Do 2º toque em diante: fluxo agêntico atual (LLM decide `send/wait/stop/handoff`), recebendo no contexto o resumo da 1ª mensagem enviada para coerência de tom.

### 3. UI — explicar a regra na Política
Em `AgenticPolicyForm.tsx`, adicionar um aviso curto no topo:
> "A primeira mensagem usa o mesmo motor das cadências padrão (knowledge da empresa, insights do lead, redes sociais, tom abaixo). A IA assume a partir do 2º toque, decidindo canal, conteúdo e quando parar."

E manter o campo "Tom / instruções da IA" — esse tom alimenta **tanto** a 1ª mensagem quanto as próximas decisões.

## Validação

1. Criar cadência inteligente nova + 1 lead com website analisado + WhatsApp → 1ª decisão em `cadence_agent_decisions` deve ter `rationale` mencionando "Primeira mensagem usando engine padrão", e a mensagem deve refletir highlights/insights da empresa (não um texto genérico).
2. Lead sem WhatsApp mas com email → 1ª mensagem sai por email com subject curto e estrutura HOOK→CONEXÃO→CTA.
3. Tom configurado na política aparece refletido no estilo da 1ª mensagem.
4. Após resposta (ou expirar o wait), 2ª decisão volta a passar pelo LLM agêntico com contexto da 1ª.
5. Cadências estáticas continuam idênticas (preview-cadence-messages só foi refatorado).

## Fora de escopo

- Migrar políticas existentes (nada muda no schema).
- Permitir editar/visualizar a 1ª mensagem antes do envio na cadência inteligente — fica como evolução futura (poderia reaproveitar o `CadenceFirstMessageInline`).
- Variações A/B na 1ª mensagem para agênticas.
