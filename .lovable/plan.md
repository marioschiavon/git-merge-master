## Contexto — o que já existe hoje

Antes de propor mudanças, o que o app já tem:

- **Bulk approve** (`useApprovals.ts:78`): entre uma mensagem e a próxima há `throttle_ms=1500` (1,5s fixo). 10 leads = ~15s → **rajada clara**, Meta detecta.
- **`auto_approve_max_per_day`** por cadência (default 50) — só limita 1ª msg auto-aprovada, não o total enviado.
- **`business_hours`** na company (9-18h, seg-sex) — usado no *scheduling* do agentic (`cadence-agent-decide`), mas **não** no momento do envio efetivo do executor nem do bulk approve.
- **1 instância Hook7 por company** (a mais recente conectada é escolhida em `getHook7SendInstance`).
- **Não existe**: jitter aleatório, cap por hora, cap por instância, warm-up de número novo, cooldown por lead.

## Diagnóstico do caso

O cliente aprovou 10 pendências de uma vez → cada uma virou POST `/send/text` no Hook7 com 1,5s entre elas, todos no mesmo minuto, para 10 números que **nunca haviam recebido nada daquele chip**. Do lado da Meta isso é a assinatura clássica de bot: mesmo IP/chip, 10 conversas novas, intervalo constante, sem inbound.

## Proposta — 6 camadas de proteção (backend, sem mudar UX além de 1 badge)

### 1. Pacer com jitter aleatório (substitui o 1,5s fixo)

Novo módulo `_shared/whatsapp-pacer.ts` chamado por **todo** call site de `sendWhatsAppViaHook7` (bulk approve, cadence-executor, approval-execute individual, send-outbound-message):

- Intervalo entre envios da **mesma instância**: aleatório entre **45s e 90s** (configurável).
- Implementado como fila persistente: tabela `whatsapp_send_queue` com `scheduled_for`. Um cron `whatsapp-send-tick` a cada 15s puxa itens vencidos.
- Envios ficam **assíncronos**: bulk approve retorna "10 enfileiradas" imediatamente; usuário vê progresso via badge (igual ao de enrichment).

### 2. Cap por hora e por dia, por instância

Novas colunas em `hook7_instances`:
- `daily_send_cap` (default 80)
- `hourly_send_cap` (default 15)

Antes de despachar um item da fila, o pacer conta `messages` `outbound` `channel=whatsapp` das últimas 1h/24h daquela instância. Se estourou, adia o item.

### 3. Warm-up automático para instância nova

Coluna `hook7_instances.connected_at`. Nos primeiros **7 dias** os caps sobem em rampa:
- D1: 20/dia, 5/hora
- D2: 30/dia, 6/hora
- D3-4: 45/dia, 8/hora
- D5-7: 65/dia, 12/hora
- D8+: cap normal configurado

### 4. Janela comercial respeitada no envio (não só no schedule)

Antes de despachar, o pacer verifica `companies.business_hours`. Fora da janela → reagenda para o próximo horário permitido + jitter. Isso protege bulk approve às 22h ou fim de semana.

### 5. Cooldown por lead (anti reenvio-espelho)

Se um lead recebeu mensagem outbound nas últimas **20 minutos**, o pacer adia — evita o cenário "aprovou 1ª msg + step-1 imediato" que gerava 2 msgs em segundos ao mesmo número.

### 6. UI mínima

- **Badge no topo de Aprovações e Cadências**: "3 enviadas agora · 7 na fila · próxima em ~1min" (usa `whatsapp_send_queue`).
- **Toast do bulk approve** muda de "10 enviadas" para **"10 enfileiradas — envio distribuído nas próximas ~10 min para não acionar filtro anti-spam do WhatsApp"**.
- **Settings → Empresa** ganha um card "Boas práticas WhatsApp" com os caps atuais editáveis e explicação em 2 linhas.

## Detalhes técnicos

**Nova tabela** (com GRANTs + RLS por company):
```sql
create table public.whatsapp_send_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  instance_id uuid not null references hook7_instances(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  approval_id uuid references approval_requests(id) on delete set null,
  payload jsonb not null,            -- { to, body, subject?, source }
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending', -- pending|sending|sent|failed|cancelled
  attempts int not null default 0,
  last_error text,
  sent_message_id uuid,
  created_at timestamptz not null default now()
);
create index on whatsapp_send_queue (status, scheduled_for);
create index on whatsapp_send_queue (instance_id, status);
```

**Novo cron** `whatsapp-send-tick` (a cada 15s, mesmo padrão do `sdr-debounce-tick`).
Puxa até 20 itens `pending` com `scheduled_for <= now()`. Para cada um:
1. Checa caps hora/dia da instância → se estourou, reagenda +1h.
2. Checa business_hours → se fora, reagenda p/ próxima janela.
3. Checa cooldown do lead → se ativo, reagenda +5min.
4. Chama `sendWhatsAppViaHook7`. Sucesso grava `messages` + marca `sent`. Falha vira `failed` após 3 tentativas.

**Refactor dos call sites** para enfileirar em vez de enviar direto:
- `approval-execute` (WhatsApp path)
- `cadence-executor` (envio WhatsApp)
- `send-outbound-message` (mensagem manual — **exceção**: envia direto por ser ação do usuário na conversa aberta, mas ainda respeita cooldown do lead)

**Config default** (editável em Settings):
- Intervalo entre envios: 45-90s aleatório
- Cap: 15/hora, 80/dia por instância (após warm-up)
- Cooldown por lead: 20min
- Warm-up: 7 dias

## Fora de escopo (fica pra depois se quiser)

- Rotação/pool de múltiplas instâncias por company (hoje só 1 conecta).
- Score de "risco" por instância baseado em reports/bloqueios.
- Detecção automática de número que já foi bloqueado antes.

## Impacto para o usuário

- 10 aprovações passam de "todas em 15s" para "todas em ~10-15min, distribuídas".
- Fim de semana / fora do horário: mensagens ficam paradas até segunda 9h automaticamente.
- Número novo não dispara 100 msgs no dia 1.
- Zero mudança no fluxo de aprovar/rejeitar — só o toast e um badge de fila.
