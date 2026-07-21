## Objetivo

Ajustar o comportamento e a comunicação do Leaderei para que:

- Respostas a leads que já estão conversando (modo resposta / priority 10) sejam enviadas **imediatamente**, independente de dia/horário comercial.
- Apenas envios de outbound frio (primeira mensagem, cadências, reengajamento) respeitem a janela de envio.
- Os avisos na UI e na documentação deixem claro que a janela protege contra spam de outbound, e não contra conversas normais.

## Contexto confirmado

- `supabase/functions/_shared/whatsapp-pacer.ts` já detecta "modo resposta" (última mensagem inbound do lead) e agenda com `priority = 10` + jitter curto (3-10s). O comentário diz que o `send-tick` vai pular business hours, mas na prática ele ainda não pula.
- `supabase/functions/whatsapp-send-tick/index.ts` aplica `business_hours` a **todos** os itens, inclusive `priority >= 10`.
- O aviso em `src/pages/settings/Settings.tsx` diz explicitamente que a janela se aplica a "todos os envios, inclusive respostas automáticas a leads que responderam".
- A página de boas práticas (`WhatsAppBestPractices.tsx`) e o doc interno (`docs/boas-praticas-whatsapp.md`) também dizem que "TODAS as mensagens" respeitam o horário comercial.

## O que será feito

### 1. Comportamento: liberar respostas a leads engajados

- Em `supabase/functions/whatsapp-send-tick/index.ts`, alterar a verificação de `business_hours` para que itens de alta prioridade (`priority >= 10`, ou seja, respostas a leads que falaram primeiro / aprovações sdr_reply) **não sejam reagendados** por estarem fora da janela comercial.
- Manter a verificação de `business_hours` para outbound frio (`priority < 10`, sources `cadence_step`, `cadence_step_custom`, `first_message`, etc.).
- Manter o bypass de caps horários/diários para respostas (já existe via `isHighPriority`).
- Atualizar o comentário em `supabase/functions/_shared/whatsapp-pacer.ts` para refletir o comportamento real e remover a ambiguidade.

### 2. Textos: remover a frase que dá a entender punição sobre respostas

- Em `src/pages/settings/Settings.tsx` (Configurações → Empresa):
  - Retirar a parte "inclusive respostas automáticas a leads que responderam".
  - Deixar o aviso focado em: "A janela de envio protege o número contra envios de outbound frio/cadências fora do horário. Respostas a leads que já estão conversando fluem normalmente."
- Em `src/pages/WhatsAppBestPractices.tsx`:
  - Alterar o card "Horário comercial" para deixar claro que a regra se aplica a mensagens automáticas/cadências.
  - Remover o exemplo de que a resposta do agente fica presa até 09h se o lead responder às 23h.
- Em `docs/boas-praticas-whatsapp.md`:
  - Reescrever a seção 3.5 para refletir a nova distinção: outbound frio respeita a janela; respostas a leads engajados não.

### 3. Validação

- Testar o fluxo: lead envia mensagem inbound fora do horário comercial → aprovação/resposta do agente é enfileirada com `priority = 10` e enviada sem esperar a janela.
- Testar o fluxo de cadência: mensagem de cadência fora do horário comercial continua sendo reagendada para o próximo horário permitido.
- Verificar se os textos renderizam corretamente na UI e não contêm mais a frase removida.

## Nota técnica

A mudança é concentrada no `whatsapp-send-tick`. O `cadence-agent-decide` continua respeitando `business_hours` para agendamento de passos de cadência (outbound), o que é o correto. A fila `whatsapp_send_queue` continua com a coluna `priority` como mecanismo de distinção entre outbound frio e resposta a lead engajado.