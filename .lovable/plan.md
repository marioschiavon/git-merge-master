## Objetivo
Adicionar um toggle por lead para escolher qual pipeline responde: **Atual** (legacy) ou **Agente** (sdr-agent). Quando "Agente" estiver ligado, o sdr-agent envia a resposta de verdade (live) e o pipeline antigo é pulado. Assim dá pra testar lado-a-lado em leads reais sem afetar os outros.

## O que muda

### 1. Schema
- Nova coluna em `leads`: `pipeline_mode text not null default 'legacy'` (valores: `legacy` | `agent`).
- Índice opcional por `company_id, pipeline_mode` pra debug.

### 2. UI — toggle no lead
- Em `LeadDetail.tsx` / `LeadDetailContent.tsx`, adicionar um Switch no topo: **"Responder com Agente SDR"** (off = pipeline atual, on = sdr-agent live).
- Badge visível na lista de leads (`Leads.tsx`) pra identificar quem está em modo agente.
- Persistir via `update` direto na tabela `leads` (RLS já protege por `company_id`).

### 3. Webhook inbound — bifurcação
Em `supabase/functions/inbound-webhook/index.ts` (e nos webhooks de email/whatsapp que chamam o mesmo fluxo):
- Após carregar `leadData`, ler `leadData.pipeline_mode`.
- Se `agent`: pular o `routeAndEnqueue` (legacy) e invocar `sdr-agent` com `mode: "live"`.
- Se `legacy`: comportamento atual + shadow do agente (sem mudança).

### 4. sdr-agent — implementar modo live
Hoje o `sdr-agent` só registra a run; em `mode: "live"` precisa efetivamente enviar. Adicionar ao final do handler, depois do `finalize`:
- Se `mode === "live"` e `decision === "send_message"`: inserir mensagem outbound em `messages` e chamar `send-outbound-message` (ou inserir em `lead_action_queue` com `action_type: "send_message"`, o mesmo caminho que o pipeline atual usa) — escolher o caminho que já existe no projeto pra reaproveitar canal (WhatsApp/email).
- Se `decision === "offer_slots"` / `book_slot`: reutilizar `calcom-booking-create` / fluxo de slot já existente.
- Se `decision === "escalate_to_human"`: setar `handoff_required = true` no lead.
- Se `silence` / `schedule_followup` / `mark_referral`: só registrar, sem envio.
- Gravar `sent: true` no `final_output` da run pra auditoria.

### 5. Painel Agent Runs
- Mostrar badge "LIVE" (vermelho) vs "SHADOW" (cinza) já existente no `mode`.
- Quando `live` e mensagem enviada, mostrar link "Mensagem enviada ✓".

## Fora de escopo
- Mudar comportamento default de novos leads (continuam `legacy`).
- Cutover global (continua opt-in por lead).
- Modo "promover proposta com 1 clique" no Agent Runs (pode vir depois se quiser).

## Riscos
- O sdr-agent passa a enviar mensagens reais nos leads marcados — comece com 1–2 leads de teste.
- Se `decision !== send_message` (ex: silence), o lead não recebe nada do pipeline atual também — comportamento esperado, mas vale saber.
