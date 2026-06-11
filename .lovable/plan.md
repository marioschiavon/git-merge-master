## Objetivo

Quando o usuário simular uma resposta do lead em uma cadência em modo simulação, a IA deve gerar a próxima mensagem outbound e inseri-la na conversa (marcada como simulada), permitindo testar o diálogo completo na tela `/conversations` sem enviar nada real.

## Mudanças

### 1. `supabase/functions/cadence-simulate-reply/index.ts`
Após classificar a intent, encadear a geração da resposta do agente:

- Chamar `cadence-agent-decide` com `{ enrollment_id, simulate_only: true }` para obter a próxima decisão (action + message) sem reenfileirar.
- Alternativa mais simples: invocar `generate-reply` (ou `ai-reply`) com o histórico da conversa, persona da cadência e contexto do lead, retornando o texto sugerido.
- Inserir o texto gerado como `messages` outbound com:
  - `conversation_id` = mesma conversa criada/usada
  - `direction: "outbound"`
  - `ai_suggested: true`
  - `channel` = canal da conversa
  - `metadata: { simulated: true, source: "cadence_simulate", intent: <classificada> }`
- Não chamar `gmail-send` nem `sendWhatsAppViaZApi`.
- Retornar `{ ok, intent, reply_text, reply_message_id }`.

### 2. `cadence-agent-decide` (ajuste leve)
Garantir que, quando invocado por `cadence-simulate-reply` (flag `from_simulation: true` no body), também insira a mensagem outbound simulada em `messages` (hoje, em `simulation_mode`, ele só registra `lead_activities` e decisões, sem popular `messages`). Isso uniformiza a visualização em `/conversations`.

Opção escolhida: deixar `cadence-agent-decide` como está e fazer a inserção de outbound dentro do próprio `cadence-simulate-reply` (menor blast radius).

### 3. `src/hooks/useSimulateCadence.ts`
`useSimulateReply` já invalida `agent_decisions_cadence`. Adicionar invalidação de:
- `["conversations", companyId]`
- `["messages"]` / `["lead-messages"]`

Toast passa a mostrar também: "Resposta da IA gerada (simulada)".

### 4. `src/components/CadenceDetail.tsx` (AgenticSimulationControls)
Após sucesso de `simulateReply`, exibir um pequeno preview inline da resposta gerada (texto + badge "🧪 IA simulada") com link "Ver na conversa" que navega para `/conversations` filtrando pelo lead.

### 5. `src/pages/Conversations.tsx`
Renderizar badge "🧪 Simulado" em mensagens cujo `metadata.simulated === true` (inbound e outbound), reaproveitando o estilo do badge IA existente. Sem novas queries.

## Fora de escopo
- Loop automático multi-turno (continuar simulando várias trocas com um clique).
- Avanço de tempo simulado / pular delays entre passos.
- Troca de canal no meio da simulação.

## Validação
1. Cadência agentic com `simulation_mode = true`, lead inscrito.
2. Em `CadenceDetail`, "Simular resposta do lead" → "podemos marcar amanhã?".
3. Esperado: toast com intent detectada; nova mensagem outbound aparece na conversa com badge simulado; nenhum envio real (sem chamadas a gmail-send / z-api nos logs).
4. Em `/conversations`, a thread mostra inbound + outbound simuladas, badges visíveis.
