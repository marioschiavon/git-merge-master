## Modo Simulação (Dry-run) para Cadência Inteligente

Permitir testar a cadência agêntica em segundos, sem enviar nada de verdade. Você dispara cada passo manualmente, vê a decisão da IA + texto da mensagem, e pode simular respostas do lead para ver como a IA reage no próximo passo.

## Mudanças

### 1. Schema — flag de simulação
Migration:
- `cadences.simulation_mode boolean NOT NULL DEFAULT false` (só faz efeito quando `mode = 'agentic'`).
- `cadence_agent_decisions.simulated boolean NOT NULL DEFAULT false` — marca decisões geradas em modo dry-run.

### 2. `cadence-agent-decide` — respeitar simulation_mode
- Quando `cadence.simulation_mode = true`:
  - **Não chama** `gmail-send` nem `sendWhatsAppViaZApi`.
  - **Não insere** linha em `messages` (a mensagem da IA fica só em `cadence_agent_decisions.message_body`).
  - Insere `lead_activities` com prefixo "🧪 [SIMULAÇÃO]" para diferenciar.
  - Persiste decisão com `simulated: true`.
  - Reagenda `next_execution_at` igual hoje (mas você pode disparar manualmente; veja item 4).

### 3. Nova edge function `cadence-simulate-reply`
Body: `{ enrollment_id, reply_text, channel? }`.
- Valida que a enrollment pertence à empresa do usuário (RLS via JWT).
- Insere uma `message` com `direction: 'inbound'`, `metadata: { simulated: true }`, no conversation correspondente (cria se não existir).
- Roda o pipeline normal de classificação de intent (`classify-intent`) sobre o texto — assim "não tenho interesse" pára a cadência, "quer reunião" registra `meeting_request`, etc.
- Retorna `{ ok, intent }`.

### 4. UI — controles no `CadenceDetail` agêntico
Em `src/components/CadenceDetail.tsx`, na aba "Decisões" da cadência agêntica adicionar:

**No topo da aba (quando `mode === 'agentic'`):**
- Toggle "Modo simulação" (atualiza `cadences.simulation_mode`). Aviso amarelo quando ligado: "Mensagens não serão enviadas".

**Na lista de leads enrolados (nova aba ou seção):**
Para cada enrollment, mostrar:
- Última decisão + status.
- Botão **"Executar próximo passo agora"** → invoca `cadence-agent-decide` com aquele `enrollment_id` (zera `next_execution_at` antes de invocar para evitar idempotência).
- Caixa de texto **"Simular resposta do lead"** + botão Enviar → invoca `cadence-simulate-reply`. Depois sugere clicar em "Executar próximo passo" para ver como a IA reage.

### 5. Hook + tipos
- `useSimulateCadence.ts`: `useToggleSimulation(cadenceId)`, `useRunNextStep(enrollmentId)`, `useSimulateReply(enrollmentId)`.
- Atualizar `useAllAgentDecisions` para exibir badge "🧪 SIMULADO" quando `simulated: true`.

### 6. Indicador visual
- Na tabela de Cadências (`Cadences.tsx`), se `simulation_mode === true`, mostrar badge amarelo "Simulação" ao lado do badge "IA".

## Fluxo de uso

1. Criar cadência inteligente → ativar "Modo simulação".
2. Adicionar 1 lead (com email/whatsapp falso ok).
3. Aba Decisões → "Executar próximo passo agora" → vê a 1ª mensagem gerada (não foi enviada).
4. Digitar resposta do lead → "Simular resposta" → intent classifica.
5. Clicar de novo "Executar próximo passo" → vê a IA decidir (send com novo texto, stop por opt-out, handoff, etc.).
6. Repetir até atingir condição de parada ou max_attempts.
7. Quando estiver satisfeito, desligar "Modo simulação" e enrolar leads reais.

## Validação

1. Toggle ligado: enroll lead, dispara passo → decisão registrada com `simulated=true`, nenhum envio externo (verificar logs do gmail-send/Z-API quietos).
2. Simular resposta "não tenho interesse" → próxima execução do agente para com `stop_reason: no_interest`.
3. Simular resposta "podemos marcar?" → IA responde com `hook: suggest_slot` ou similar.
4. Toggle desligado: comportamento normal, envia de verdade.
5. Decisões simuladas aparecem com badge na aba Decisões.

## Fora de escopo

- Resetar enrollment para começar a simulação do zero (poderia ser um botão "Reiniciar simulação para este lead"; posso adicionar se quiser).
- "Avançar tempo" simulado (mudar `enrolled_at` para forçar `max_days`). Em vez disso, basta clicar "Executar próximo passo" até `max_attempts`.
- Gerar leads sintéticos automaticamente para teste em massa.
