# Fase 4 — Switchover completo para Hook7 (sem fallback Z-API)

## Objetivo
Migrar 100% do envio outbound de WhatsApp para Hook7, usando o token dedicado por instância de cada company. Remover o Z-API do caminho de envio. Quando a company não tiver instância Hook7 **conectada**, o envio falha com mensagem clara (mesmo comportamento que hoje acontece quando não há Z-API).

## O que muda

### 1. Novo helper compartilhado
`supabase/functions/_shared/hook7-whatsapp.ts`
- `resolveConnectedInstance(admin, companyId)` — busca em `hook7_instances` a instância `status='connected'` mais recente da company.
- `sendWhatsAppViaHook7(admin, instance, toPhone, body)` — carrega o token via `loadInstanceToken`, chama `POST {baseUrl}/message/sendText/{externalName}` (mesmo endpoint do Foundation), normaliza telefone para dígitos com DDI, retorna `{ ok, sid, status, error }` no mesmo formato que o helper Z-API atual usa.

### 2. Substituir Z-API no envio outbound
Trocar as chamadas de `getZApiConfig` + `sendWhatsAppViaZApi` por `resolveConnectedInstance` + `sendWhatsAppViaHook7` em:
- `supabase/functions/send-outbound-message/index.ts` (Inbox / envio manual)
- `supabase/functions/cadence-executor/index.ts` (passos de cadência WhatsApp)
- Qualquer outro caller de `_shared/zapi-whatsapp.ts` que apareça no grep antes da edição.

Mensagens de erro:
- Sem instância conectada → `delivery_status='failed'`, `delivery_error='Nenhuma instância WhatsApp (Hook7) conectada para esta empresa'`.
- Erro HTTP Hook7 → repassa `error`/`status` no metadata da mensagem, igual ao padrão atual.

### 3. Webhook Hook7: ingestão de mensagens
Estender `supabase/functions/hook7-webhook/index.ts` (hoje só trata `CONNECTION`) para também processar:
- `MESSAGE` inbound (`fromMe=false`) → cria/atualiza `conversations` + insere em `messages` como `direction='inbound'`, resolvendo o `lead` por telefone dentro da company da instância. Reaproveita a lógica que o `zapi-webhook` já usa.
- `SEND_MESSAGE` / `READ_RECEIPT` → atualiza `metadata.delivery_status` da mensagem outbound correspondente (via `zapi_message_id` renomeado para `wa_message_id`).

### 4. Limpeza do Z-API
- Remover cards e ações Z-API de `src/pages/settings/Integrations.tsx` (fica só o card WhatsApp/Hook7).
- Remover hooks/telas que testam Z-API (`zapi-test-connection` deixa de ser chamado pela UI).
- Manter os arquivos `_shared/zapi-whatsapp.ts`, `zapi-webhook`, `zapi-test-connection` no repositório por enquanto (sem referências vivas), para deletar numa Fase 5 dedicada depois de você validar em produção.

### 5. Correção do runtime error observado
`supabase.auth.getClaims is not a function` está vindo de uma das funções novas do Hook7 (usa API que não existe no `@supabase/supabase-js@2.45.4`). Trocar por `supabase.auth.getUser()` no ponto que estiver usando `getClaims`.

## Fora de escopo desta fase
- Deletar arquivos/tabelas do Z-API (fica para a Fase 5 após validação).
- Migração de histórico de conversas antigas.
- UI nova no Inbox — o fluxo de envio continua idêntico do ponto de vista do operador.

## Critério de aceite
- Enviar mensagem manual pelo Inbox de uma company com instância Hook7 conectada entrega via Hook7 e a mensagem aparece no WhatsApp do lead.
- Cadência WhatsApp dispara passos usando o token da instância da company dona da cadência.
- Company sem instância conectada recebe erro claro ("Nenhuma instância WhatsApp conectada"), sem cair em Z-API.
- Mensagem recebida no WhatsApp do número conectado aparece como inbound na conversa correspondente.
- Erro `getClaims is not a function` deixa de aparecer.
