## Abordagem híbrida (regex + IA só quando precisa)

Regex continua sendo a primeira camada — é determinístico, grátis e roda em todo inbound. A IA entra **só** quando há sinal de referral mas o regex não conseguiu um nome confiável. Isso mantém custo/latência baixos e resolve casos como "Dra. Claudia", "dr joão silva", "a Cláudia, que cuida disso".

## Mudanças

### 1. `supabase/functions/_shared/entity-extractor.ts`

- **Marcar nome como "fraco"** quando o regex só capturou um título (`Dr`, `Dra`, `Sr`, `Sra`, `Srta`, `Prof`, `Profa`) sem nome próprio à frente. Nesses casos `name` fica `undefined` e adicionamos um campo interno `name_needs_llm: true` no `ReferralContact` (não persistido, só sinal pra camada de cima).
- **Pequena melhoria no regex** (barata): aceitar ponto opcional após cada token (`[A-ZÀ-Ý][\wÀ-ÿ'-]+\.?`) pra pegar "Dra. Claudia" sem precisar de LLM no caso simples. Normalizar removendo o ponto final antes de retornar.
- Manter detecção de email/telefone/`redirect_signal`/`permission_to_mention` 100% determinística.

### 2. Nova edge function `supabase/functions/extract-referral-name/index.ts`

- Entrada: `{ text: string }` (último inbound do lead, truncado a ~500 chars).
- Usa AI SDK + Lovable AI Gateway com `google/gemini-3-flash-preview` (rápido/barato) e `Output.object` com schema mínimo: `{ name: string | null, confidence: "high" | "low" }`.
- Prompt curto e específico: "Extraia APENAS o nome próprio da pessoa indicada (não o remetente). Inclua título se citado (Dr./Dra.). Retorne null se não houver nome claro."
- CORS + `verify_jwt = false` (chamada server-to-server da função consumidora).
- Validação Zod do body, timeout curto, fallback `name: null` em erro.

### 3. Consumidor (`supabase/functions/sdr-agent/index.ts` ou onde o `extractEntities` é chamado hoje)

- Após `extractEntities(...)`, se `referral_contact?.name_needs_llm === true` **e** (`redirect_signal` for true OU `email`/`phone` foram detectados), chamar `extract-referral-name` com o `lastInbound`.
- Se vier `name` com `confidence: "high"`, popular `referral_contact.name`. Senão, deixa `undefined` (lead segue sem nome, igual hoje).
- Logar a decisão pra observabilidade.

### 4. Testes (`entity-extractor_test.ts`)

- "fala com a Dra. Claudia" → regex resolve direto, `name === "Dra Claudia"`, `name_needs_llm` falso.
- "fala com a Dra" (só título) → `name` undefined, `name_needs_llm: true`.
- "é o Carlos Vilagran" / "fala com Andreia" → regressão, segue funcionando.
- Sem sinal de referral → `referral_contact === null` (não dispara LLM).

## Por que esse desenho

- **Custo**: LLM só roda em mensagens com sinal de referral E nome ambíguo — fração pequena do tráfego.
- **Latência**: o caminho comum (regex resolve) não muda; só o caso ambíguo paga ~500ms extras.
- **Auditável**: regex continua testável; resposta da IA é estruturada (schema) e logada.
- **Sem regressão**: se a edge function falhar ou retornar `null`, o comportamento volta a ser exatamente o atual.

## Fora de escopo

- Não trocar todo o `entity-extractor` por LLM.
- Não usar IA pra email/telefone/datas/slots — regex e parsers já cobrem bem.
- Não mudar o frontend nem o schema do banco.
