# Bitrix24 — Fase 2: o negócio acompanha o estágio do lead

Hoje a integração faz só duas coisas: cria o negócio quando o lead é abordado e move de etapa quando a IA passa para um humano. Falta refletir os outros momentos.

## Estado atual verificado

- O gatilho no banco enfileira apenas dois eventos: `create_deal` (status virou "abordado") e `move_stage` (handoff ligado).
- A configuração salva hoje tem: funil, etapa de criação, etapa de handoff, fonte e o de/para de campos.
- Não existe nenhum gatilho ligado a resposta do lead nem a reuniões.
- A tabela `leads` não guarda "respondeu"; esse sinal está na conversa (último recebido) e nas mensagens recebidas.
- Reuniões ficam na tabela `bookings`, ligada ao lead.

## O que será construído

### Três novas etapas configuráveis

No card do Bitrix24, além de "etapa de criação" e "etapa de handoff", passam a existir:

1. **Em conversa** — quando o lead responde pela primeira vez a uma abordagem da IA.
2. **Reunião agendada** — quando uma reunião é criada na agenda para esse lead.
3. **Atendimento humano** — a etapa de handoff que já existe, apenas renomeada na tela para ficar claro.

Cada uma é opcional: etapa não escolhida = evento simplesmente ignorado, sem chute.

### Quando cada movimento acontece

- **Em conversa:** primeira mensagem recebida do lead (WhatsApp ou e-mail).
- **Reunião agendada:** reunião criada para o lead (inclusive quando marcada pela própria IA).
- **Atendimento humano:** handoff ligado, como hoje, levando o resumo da conversa.

### Nunca voltar atrás

O negócio só avança. A ordem usada é: criação → Em conversa → Reunião agendada → Atendimento humano. Se o lead responde depois de já ter reunião marcada, o card não volta para "Em conversa".

### Acompanhamento

O painel da fila no card do Bitrix24 continua igual, agora também contando esses novos movimentos, com o último erro visível.

## Notas técnicas

- Migration: novos valores de evento em `bitrix_sync_queue` (`stage_replied`, `stage_meeting`; `move_stage` continua sendo o handoff, sem quebrar itens já existentes). Coluna `stage_rank` em `bitrix_deals` para bloquear regressão.
- Novos gatilhos, todos só enfileirando (nenhuma função existente é alterada):
  - `AFTER INSERT` em `messages` para `direction = 'inbound'` → `stage_replied` (o `ON CONFLICT (lead_id, event) DO NOTHING` já garante uma única vez por lead).
  - `AFTER INSERT` em `bookings` (e `UPDATE` para `confirmed`/`rescheduled`) → `stage_meeting`.
- `bitrix24-queue-worker`: um único caminho de "mover etapa" parametrizado pelo evento; lê `stage_*` da config, compara `stage_rank` gravado e só chama `crm.deal.update` quando o novo rank é maior. Se ainda não houver negócio, enfileira `create_deal` e adia, como já faz hoje.
- `Bitrix24Dialog.tsx` e `useBitrix24.ts`: dois selects novos (`stage_replied`, `stage_meeting`) usando as etapas já retornadas pelo `bitrix24-discover` — nenhuma chamada nova ao Bitrix.
- Manual `docs/manual/03f-bitrix24.md` atualizado com as novas etapas e a regra de não regressão; versão `beta 0.53` e entrada no patch log do dia.

## Fora de escopo

Webhook de volta do Bitrix (mover no CRM não altera o lead no Leaderei), etapas de ganho/perda e importação de dados do Bitrix.
