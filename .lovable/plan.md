## Problema

Na tela **Runs do Agente**, o painel "Agente (proposta)" aparece vazio em vários casos legítimos:

1. **Fallback de finalize.** Quando o modelo responde só em texto (sem chamar a tool `finalize`), o `sdr-agent` salva `{ raw: "...texto...", decision: "silence", rationale: "Modelo não chamou finalize" }`. O texto existe, mas fica em `raw`, e a UI só lê `final_output.message`.
2. **Decisões sem mensagem por design.** Runs com `decision = silence`, `escalate_to_human`, `schedule_followup` ou `mark_referral` não têm `message`. Hoje a UI mostra "— sem mensagem —" sem explicar o motivo nem o raciocínio.
3. **Inbound desalinhado.** A "Mensagem do lead (gatilho)" usa o último inbound `<= run.created_at`. Em conversas com vários runs próximos no tempo (caso desta conversa, 5 runs em ~10 min), pode mostrar um inbound diferente do que de fato disparou aquele run.

## Solução

Duas mudanças cirúrgicas, sem mexer no resto do pipeline.

### 1. `supabase/functions/sdr-agent/index.ts` — reduzir fallback silencioso

Quando o modelo termina sem chamar `finalize` mas devolveu texto livre:

- Em vez de gravar `decision: "silence"` com `raw`, fazer uma chamada extra (1 turno) **forçando** `tool_choice` para `finalize`, passando o texto livre como contexto: "Você terminou sem chamar finalize. Converta sua resposta acima em uma chamada de `finalize` com decision/message/rationale apropriados."
- Se mesmo após o retry o modelo não chamar `finalize`, gravar `decision: "send_message"` com o `raw` como `message` e `rationale: "fallback: modelo não chamou finalize"`. Assim a proposta nunca se perde silenciosamente.
- Logar `steps` com o evento `finalize_retry` para visibilidade.

### 2. `src/pages/AgentRuns.tsx` — mostrar o que o agente realmente produziu

No card "Agente (proposta)":

- Se `final_output.message` está vazio, exibir `final_output.raw` (quando existir) com um aviso amarelo "Texto livre — agente não chamou `finalize`".
- Para `decision ∈ {silence, escalate_to_human, schedule_followup, mark_referral}`, exibir uma explicação clara em vez de "— sem mensagem —": ex.: "Agente decidiu **escalar para humano** (não envia mensagem). Motivo: \<rationale\>".
- Sempre mostrar o `decision` badge mesmo quando não há mensagem (hoje o badge sai quando `final_output?.decision` existe — confirmar render incondicional).
- Manter a `rationale` sempre visível abaixo dos dois painéis.

Alinhamento de inbound (correção menor): em vez de "último inbound `<=` created_at", buscar o inbound cujo `sent_at` esteja na janela `[run.created_at - 2min, run.created_at]`. Reduz o risco de mostrar um inbound antigo.

## Resultado esperado

- O run a65e74d1 desta conversa passaria a aparecer com o texto que o modelo já tinha escrito (ou com decisão clara após o retry de finalize).
- Runs de escalate/silence/followup deixam de parecer "bug" — viram explicação acionável para o time validar o shadow.
- Próximos runs com fallback ficam raros (retry forçado) e, quando ocorrerem, ficam rastreáveis nos `steps`.

## Arquivos alterados

- `supabase/functions/sdr-agent/index.ts` (retry de finalize + fallback para send_message com raw)
- `src/pages/AgentRuns.tsx` (render do `raw`, explicação por tipo de decisão, ajuste de janela do inbound)