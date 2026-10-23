# Pipedrive — esteira automática no modelo do Bitrix24

O Pipedrive passa a ter dois modos lado a lado no mesmo card de Configurações → Integrações:

- **Importar contatos** (já existe): continua puxando pessoas do Pipedrive para Leads, agora só pelo botão manual. Nada automático vindo do Pipedrive.
- **Enviar negócios** (novo): mão única Leaderei → Pipedrive, igual ao Bitrix24. Liga/desliga independente.

## Fase 1 — Criação do negócio

Quando o lead é abordado pela primeira vez (status vira "abordado"), o Leaderei:

1. Procura a pessoa no Pipedrive (pelo vínculo já salvo na importação, depois por e-mail, depois por telefone). Se não achar, cria.
2. Procura ou cria a organização pelo nome da empresa do lead.
3. Cria o negócio no funil e na etapa escolhidos, com o de/para de campos.
4. Grava o vínculo para nunca duplicar.

Leads de organizações em "Não prospectar" nunca são enviados.

## Fase 2 — O negócio acompanha o lead

Etapas configuráveis (cada uma opcional; sem etapa = evento ignorado):

```text
Criação -> Em conversa -> Reunião agendada -> Atendimento humano
```

- **Em conversa:** primeira resposta do lead (WhatsApp ou e-mail).
- **Reunião agendada:** reunião criada/confirmada/remarcada.
- **Atendimento humano:** handoff da IA, com o resumo da conversa anexado como nota no negócio.

O negócio só avança, nunca volta.

## Tela do card Pipedrive

Duas abas:

- **Importação:** token conectado, botão "Importar contatos agora", última importação. Aviso de que é manual.
- **Envio de negócios:** chave liga/desliga, funil, as 4 etapas, dono do negócio (opcional), de/para de campos (Leaderei → Pessoa / Negócio, incluindo campos personalizados), painel da fila (pendentes, falhas, último erro) e botão "Tentar falhas novamente".

## Documentação e versão

- Manual `03d-pipedrive.md` reescrito com os dois modos.
- Beta 0.92 e patch log em linguagem de cliente.

## Fora do escopo

- Nada é apagado no Pipedrive nem no Leaderei.
- Mudanças feitas no Pipedrive não voltam para o Leaderei.
- A importação manual deixa de remover leads apagados no Pipedrive se o lead já tiver negócio enviado pela esteira (evita perder histórico).

## Notas técnicas

- Migration: tabelas `pipedrive_sync_queue` (eventos `create_deal`, `stage_replied`, `stage_meeting`, `move_stage`; `UNIQUE(lead_id, event)`; status/attempts/next_attempt_at/last_error) e `pipedrive_deals` (deal_id, person_id, org_id, current_stage, stage_rank, `UNIQUE(company_id, lead_id)`). GRANT SELECT para authenticated, ALL para service_role, RLS por `get_user_company_id`.
- Gatilhos só enfileiram, checando `integrations.provider='pipedrive' AND status='active' AND config->>'push_enabled'='true'` e `is_lead_protected`: AFTER UPDATE em `leads` (abordado / handoff), AFTER INSERT em `messages` inbound, AFTER INSERT/UPDATE em `bookings`. Separados dos gatilhos do Bitrix.
- `_shared/pipedrive.ts`: cliente API v1 com token na query (só no servidor), timeout 10s, ~2 req/s, build de campos via de/para.
- `pipedrive-discover`: lista pipelines, stages, users, personFields e dealFields.
- `pipedrive-queue-worker` (cron a cada minuto, 20 itens): config incompleta → skipped; backoff 1/5/25/60/120 min, falha após 5 tentativas; se não há negócio em evento de etapa, enfileira create_deal e adia; compara stage_rank antes de `PUT /deals/:id`; nota de handoff via `POST /notes`.
- `pipedrive-sync`: sem cron; remoção pula leads com vínculo em `pipedrive_deals`.
- Frontend: `usePipedrivePush.ts` (config, discover, fila, retry) e novo `PipedriveDialog.tsx` com Tabs, seguindo `Bitrix24Dialog.tsx`.
- Testes Deno em `tests/` para a regra de não regressão de etapa e o mapeamento de campos.
