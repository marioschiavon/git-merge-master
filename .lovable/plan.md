# Problema

Ao clicar em **Executar Agora** na cadência `teste email`, o request falha com `504 IDLE_TIMEOUT (150s)` e a cadência não roda.

**Causa raiz confirmada nos logs/rede:**

- O botão chama `POST /functions/v1/cadence-executor` **sem body**.
- Sem `enrollment_id` no body, o executor busca **todos os enrollments ativos com `next_execution_at` vencido, de todas as empresas** (`cadence-executor/index.ts:82-90`).
- Nos logs do `cadence-agent-decide` aparecem enrollments de outras companies (`81e955d3…`, `b9876b4c…`, `8682f44a…`) sendo processados na mesma execução.
- Para cada enrollment em modo `agentic`, o executor faz `await supabase.functions.invoke("cadence-agent-decide", …)` sequencial (linha 155-157). Com N enrollments × latência do agente (LLM + tools), passa dos 150 s do gateway → **504** e o cliente nunca vê a resposta.
- O enrollment do usuário (`945c74d7…`, cadência `c8eaebd1…`, lead `mario@s7.dev.br`) provavelmente é processado, mas o request morre antes de responder e a UI mostra erro.

# O que mudar

Escopar o "Executar Agora" à cadência atual **e** parar de bloquear o request esperando o agente terminar.

## 1. Frontend — `src/hooks/useCadences.ts`

`useExecuteCadenceNow` passa a aceitar um `cadenceId` opcional e o envia no body:

```ts
supabase.functions.invoke("cadence-executor", {
  body: cadenceId ? { cadence_id: cadenceId } : {},
});
```

Ajustar `src/components/CadenceDetail.tsx` (linha ~322) e `src/pages/CadencesDashboard.tsx` (linha 129/228) para chamar `executeCadence.mutate(cadence.id)`.

## 2. Backend — `supabase/functions/cadence-executor/index.ts`

- Ler `cadence_id` do body (junto com `enrollment_id`, `bypass_hitl` que já existem).
- Se vier `cadence_id`, adicionar `.eq("cadence_id", cadence_id)` na query de enrollments (mantém os filtros de `status/next_execution_at/meeting_scheduled`).
- No branch `cadence.mode === "agentic"` (linha 153-164): trocar o `await supabase.functions.invoke(...)` por uma invocação **fire-and-forget** dentro de `EdgeRuntime.waitUntil(...)`, para que o executor retorne assim que despachar as decisões (o `agent-decide` continua rodando em background e já grava tudo no banco).
- Contar como `processed++` no momento do despacho.

## 3. Sem mudança de schema, RLS ou de regras de negócio

Só escopo de execução e concorrência. A execução em background do agente já é o padrão dos crons que chamam esse endpoint.

# Verificação

- Recriar a situação: enrollment ativo da cadência `teste email` → clicar **Executar Agora**.
- Esperado: resposta em < 5 s com `{ processed: 1 }`, sem 504, e log `[cadence-agent-decide] decision` para o `enrollment_id` correto aparecendo em seguida.
- Bump `APP_VERSION` para `beta 0.13`.
