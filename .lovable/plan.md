# Validação de WhatsApp via Z-API no enriquecimento

Adicionar uma etapa de validação de número de WhatsApp durante o enriquecimento automático de cada lead, usando a Z-API da própria empresa. Se o número não tiver WhatsApp, os passos de WhatsApp da cadência são automaticamente pulados.

## 1. Schema (migração)

**`leads`** — novas colunas:
- `whatsapp_valid` boolean (nullable — `null` = não verificado, `true` = tem WhatsApp, `false` = não tem)
- `whatsapp_checked_at` timestamptz
- `whatsapp_check_error` text (motivo de falha, ex: "phone_invalid_format", "zapi_error")

**`companies.enrichment_settings`** (jsonb) — novo campo `validate_whatsapp` boolean (default `false`).

## 2. Edge function: `enrich-lead`

Adicionar nova etapa "Validar WhatsApp" no pipeline, executada quando `enrichment_settings.validate_whatsapp = true`:

1. Lê `phone` ou `whatsapp` do lead.
2. Normaliza para E.164 sem `+` (ex: `5511999999999`). Se inválido → grava `whatsapp_check_error = 'phone_invalid_format'`, `whatsapp_valid = false`.
3. Busca credenciais Z-API em `integrations` (provider `zapi`) da empresa: `instance_id` + `token` + `client_token`.
4. Chama `GET https://api.z-api.io/instances/{instance}/token/{token}/phone-exists/{phone}` com header `Client-Token`.
5. Grava `whatsapp_valid` (resultado), `whatsapp_checked_at = now()`.
6. Loga em `lead_activities` (tipo `enrichment`).

## 3. UI — Configurações de Enriquecimento

**`src/components/EnrichmentSettingsCard.tsx`**: adicionar toggle "Validar WhatsApp via Z-API" com descrição curta. Indicar que requer integração Z-API ativa.

## 4. UI — Lead

**`src/components/LeadDetailContent.tsx`**: badge ao lado do telefone:
- ✅ verde "WhatsApp válido" se `whatsapp_valid = true`
- ⚠️ cinza "Sem WhatsApp" se `whatsapp_valid = false`
- Sem badge se `null`

## 5. Cadence executor — pular passos de WhatsApp

**`supabase/functions/cadence-executor/index.ts`**: antes de executar um step de canal `whatsapp`, se `lead.whatsapp_valid === false`:
- Marca o step como `skipped` com motivo "WhatsApp não disponível"
- Avança para o próximo step
- Loga em `execution_logs`

Mesma lógica no `cadence-agent-decide` (SDR autônomo) — não escolher ação de WhatsApp se o lead não tem.

## 6. Backfill opcional

Não fazer backfill automático. Leads existentes ficam com `whatsapp_valid = null` e só serão validados em uma re-execução de enriquecimento (botão "Re-enriquecer" no lead — já existe).

## Validação

- Toggle desligado → enriquecimento não chama Z-API (comportamento atual).
- Toggle ligado + número válido com WhatsApp → `whatsapp_valid = true`, badge verde, cadência envia normal.
- Toggle ligado + número sem WhatsApp → `whatsapp_valid = false`, badge cinza, cadence-executor pula steps de WhatsApp.
- Sem credenciais Z-API → erro logado, lead fica `whatsapp_valid = null`.

## Arquivos tocados

- Migration SQL (colunas em `leads`)
- `supabase/functions/enrich-lead/index.ts`
- `supabase/functions/cadence-executor/index.ts`
- `supabase/functions/cadence-agent-decide/index.ts`
- `src/components/EnrichmentSettingsCard.tsx`
- `src/components/LeadDetailContent.tsx`
