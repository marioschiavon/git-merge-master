# Lovable AI Gateway — Contrato usado pelo SDR Agent

Este documento descreve como o gateway é consumido pelas edge functions deste projeto
(em especial `sdr-agent`) e o que precisa ser preservado em qualquer refactor para
não quebrar o tool-calling loop.

## Onde o cliente vive

`supabase/functions/_shared/ai-gateway.ts` — wrapper fino sobre o endpoint
OpenAI-compatible (`https://ai.gateway.lovable.dev/v1`). Exporta:

- `chatCompletion({ model, messages, tools?, tool_choice?, temperature? })`
- `createEmbedding({ model, input })`
- Tipos: `ChatMessage`, `ToolDef`.

A função usa `LOVABLE_API_KEY` no header `Authorization: Bearer …`. Nunca expor a
chave em código de front-end.

## Formato esperado de `messages`

A ordem das mensagens importa e é preservada literalmente pelo gateway:

1. `{ role: "system", content }` — prompt base + bloco de estado estruturado
   (`renderStateBlock(state)` do `state-machine.ts`).
2. Histórico nativo (`buildNativeHistory`):
   - `assistant` para turnos do SDR;
   - `user` para respostas do lead;
   - `system` para eventos internos (booking criado/cancelado etc).
   Cada mensagem leva prefixo `[HH:MM]` em BRT.
3. Pares `assistant`/`tool` gerados pelo loop atual:
   - `{ role: "assistant", content?, tool_calls?: [...] }`
   - `{ role: "tool", tool_call_id, name, content: JSON.stringify(result) }`
4. `{ role: "user", content }` final com a TAREFA do turno.

Regras rígidas:

- **Toda mensagem `role: "tool"` precisa do `tool_call_id` exato** que veio no
  `tool_calls[].id` da resposta assistant anterior. Se faltar/divergir, o gateway
  retorna 400 e o modelo perde o link da chamada.
- O `name` em `role: "tool"` deve bater com o `function.name` da chamada.
- `content` de mensagens `tool` é **sempre string** (use `JSON.stringify`). O
  modelo recebe JSON parseado por baixo dos panos, então o conteúdo precisa ser
  JSON válido.
- Não intercalar mensagens entre `assistant(tool_calls)` e seus `tool` results.

## `tool_choice`

- `"auto"` (padrão) — modelo decide se chama tool ou responde em texto.
- `{ type: "function", function: { name } }` — força a tool específica
  (usado no re-prompt da Fase 3 quando `finalize_allowed=false`).
- Não usar `"none"`; preferimos remover a tool da lista quando ela não pode ser
  chamada.

## Schemas de tool

- `parameters` é JSON Schema. **Sempre** incluir `additionalProperties: false`
  para todas as tools booking/finalize — o gateway repassa `strict: true` para
  o modelo e validação de tipos fica mais previsível.
- `enum` em `decision` deve casar exatamente com o que o loop sabe lidar
  (`send_message`, `offer_slots`, `silence`, `escalate_to_human`, `referral_chain`).
- Argumentos opcionais devem aparecer em `properties` mas fora de `required`.

## Run ID / headers de observabilidade

O gateway responde com `X-Lovable-AIG-Run-ID` e `X-Lovable-AIG-Log-ID`. Estes
**não** são gerados pelo app — só propagados. Em edge functions chamadas por
webhook não precisamos repassar; em rotas chamadas pelo browser, devolver os
headers prefixados `X-Lovable-AIG-` ao cliente.

## Erros que aparecem na prática

- **400** — request body inválido (schema do `parameters`, mensagem com role
  inválido, `tool_call_id` ausente, ou modelo recusou pelo conteúdo).
  Não tentar de novo sem mudar o body.
- **402** — créditos esgotados. Logar e parar o run.
- **429** — rate limit. Backoff exponencial ou enfileirar.
- **5xx** — falha transitória. Retry com jitter (no máximo 1 retry no loop).

Toda chamada deve checar `res.choices?.[0]?.message` — modelos podem voltar com
`finish_reason="length"` (truncado) ou `"tool_calls"` (esperado quando há
`tool_calls`). Se `finish_reason="length"`, **não** alimentar a mensagem
truncada de volta no histórico nativo.

## Modelos suportados (hoje)

- `google/gemini-3-flash-preview` — padrão do SDR (`MODEL`).
- `google/gemini-3-pro-image-preview` — usado em image-gen scripts.
- Modelos OpenAI/Anthropic via gateway funcionam, mas o schema de tool pode
  exigir simplificação (Gemini é o mais sensível a enums grandes/schemas
  profundos: "too many states").

Se trocar de modelo, revisar:

1. Limite de tokens do prompt (system + state block é grande).
2. Compatibilidade com `additionalProperties: false`.
3. Comportamento de `tool_choice` forçado.
