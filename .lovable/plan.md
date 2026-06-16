## Problema
Quando a IA (ou outro fluxo) já reservou 2 holds em `slot_holds` antes do operador assumir, o painel "Copiloto humano" não mostra esses horários — o operador precisa clicar em "Sugerir 2 horários" de novo para ver chips clicáveis, gerando novos holds e duplicando reservas no Cal.com.

## Mudança (frontend, escopo mínimo)
Na aba **Sugerir** do `HumanCopilotPanel.tsx`, mostrar automaticamente os holds **ativos e não expirados** do lead (`slot_holds.status = 'held'` e `expires_at > now()`), cada um com botão **"Agendar"** que chama o `human-book-slot` com `hold_id` (mesma rotina já usada).

### Implementação
1. Em `HumanCopilotPanel.tsx`:
   - Importar `useSlotHolds` (já existe em `src/hooks/useSlotHolds.ts`).
   - `const holds = useSlotHolds(leadId);` filtrar `h.status === 'held' && new Date(h.expires_at) > new Date()`.
   - Na aba `Sugerir`, **antes** do botão "Sugerir 2 horários", renderizar bloco "Horários já reservados" com chips no mesmo formato dos `slots` locais:
     - label via `formatSlotBRT(h.slot_datetime)` (export já existe no hook).
     - botão "Agendar" → `handleBookHold({ hold_id: h.id, slot_datetime, label })`.
   - Mostrar pequena tag `expira em Xmin` (calculada a partir de `expires_at`).
   - Após `handleBookHold` sucesso: `holds.refetch()` para somem da lista.
2. O botão "Sugerir 2 horários" continua existindo para o caso de não haver holds ativos (ou o operador querer novos).
3. `useSlotHolds` já tem `refetchInterval: 30000`; mantém.

## Fora de escopo
- Realtime via postgres_changes (refetch a cada 30s já basta).
- Mudar `human-offer-slots` para reaproveitar holds existentes.
- Mudar backend.

## Resultado
Assim que o operador entra na Inbox de uma conversa que já tem 2 holds reservados, eles aparecem na aba **Sugerir** com botão **Agendar** de 1 clique — sem gerar reservas duplicadas.