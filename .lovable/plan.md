## Problema

No modo agente (live), o lead recebe DUAS mensagens em sequência para a mesma resposta, cada uma com 2 horários diferentes (4 no total). Olhando `messages` para a conversa de hoje:

```
14:06:54  outbound action=reject_slots  📅 15/jun 09:45 / 17/jun 15:30
14:06:59  outbound action=send_reply    📅 03/jul 09:45 / 06/jul 09:45
14:06:26  inbound  "Desculpe, essas não consigo"
```

Causa: `supabase/functions/inbound-webhook/index.ts` dispara DOIS pipelines em paralelo para todo inbound:

1. **Pipeline legado** (linhas ~270 → 2280): classify → ações `schedule`/`n`/`reject_slots` → chama `calcom-slots` (cria novos holds) → envia outbound via Z-API (linha 2255).
2. **sdr-agent live** (linha 452): também faz seu próprio `check_calendar` (holds novos) e envia outbound via `execute-action`.

Já existe um gate em `!isAgentMode` para o pipeline de "intent routing" (linha 392), mas o pipeline de scheduling/reply legado roda sempre. Resultado em agent mode: duas respostas, dois conjuntos de slots reservados.

## Mudança

### `supabase/functions/inbound-webhook/index.ts` — short-circuit quando agent mode

Depois do bloco que dispara o `sdr-agent` (linha 474), adicionar:

```ts
if (isAgentMode) {
  console.log(`agent mode: skipping legacy classify/scheduling/outbound for lead=${leadData.id}`);
  return new Response(JSON.stringify({ ok: true, agent_mode: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

Isso pula:
- Toda a classificação por IA (action=reply/schedule/n/confirm_slot/…)
- Chamadas legadas a `calcom-slots` (sem duplicar holds)
- Envio outbound via Z-API do pipeline antigo (sem mensagem duplicada)

O que continua acontecendo antes do early return e segue valendo em agent mode:
- Lead criado/atualizado
- Mensagem inbound gravada em `messages`
- Conversa criada/atribuída
- Captura de auto-reply do destino
- Trigger do `sdr-agent` (ele cuida de holds, resposta, handoff, cadência via `execute-action`)

### Fora do escopo

- Limpar holds antigos já reservados em duplicidade.
- Mudar o pipeline legado para leads que NÃO estão em agent mode (continua igual).
- UI de cadência/enrollment em agent mode (o agente já controla via `execute-action`).

## Verificação

1. Deploy de `inbound-webhook`.
2. Mandar mensagem rejeitando slots no lead em agent mode → esperar UMA única outbound, e `slot_holds` com no máximo 2 novos registros (não 4).
