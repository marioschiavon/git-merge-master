
## Objetivo

1. Trocar o rótulo/descrição de "Validar WhatsApp (Z-API)" por Hook7 e migrar o fluxo real de verificação de número para Hook7 (backend Evolution).
2. Deixar todas as opções do card **Enriquecimento automático de leads** ligadas por padrão.

## 1. Frontend — `src/components/EnrichmentSettingsCard.tsx`

Todas as toggles passam a usar o padrão "ligado até desativar explicitamente" (`settings.x !== false`):

- `website_analysis`
- `discover_socials`
- `autofill_contacts` (já era)
- `validate_whatsapp`
- `generate_message`

Atualizar o toggle de WhatsApp:

- Rótulo: **"Validar se o número tem WhatsApp (Hook7)"**
- Descrição: **"Consulta o Hook7 para confirmar se o telefone do lead está registrado no WhatsApp. Se não estiver, a cadência pula automaticamente os passos de WhatsApp. Requer uma instância do Hook7 conectada."**

Observação: como agora o default é "ligado", o gatilho de enriquecimento (`enqueue_lead_enrichment`) continua funcionando — ele já dispara quando qualquer flag relevante está ativa.

## 2. Backend — verificação de número via Hook7

### 2.1 `supabase/functions/_shared/hook7-whatsapp.ts`

Adicionar `checkPhoneExistsOnWhatsApp(admin, companyId, toPhone)` que:

1. Resolve a instância conectada via `getHook7SendInstance`.
2. Carrega o token via `loadInstanceToken`.
3. Faz `POST {HOOK7_BASE}/chat/whatsappNumbers/{external_name}` com `{ numbers: [phone] }` e header `apikey: <token>` (endpoint padrão Evolution).
4. Retorna `{ ok, exists?, status?, error? }` no mesmo shape do helper Z-API anterior, para não mexer nos call sites.

Também expor um alias `checkPhoneExistsOnWhatsAppLegacy(cfg, phone)` que aceita o "sender" devolvido por `getZApiConfig` (compatível com o código atual do `enrich-lead`), delegando ao helper acima.

### 2.2 `supabase/functions/enrich-lead/index.ts` (linhas 514–551)

Trocar o bloco "Step 5: validate WhatsApp via Z-API":

- Import passa de `../_shared/zapi-whatsapp.ts` para `../_shared/hook7-whatsapp.ts`.
- `getZApiConfig` → usar `getHook7SendInstance(supabase, job.company_id)`.
- Se não houver instância conectada → `steps.validate_whatsapp = "hook7_not_configured"`.
- Caso contrário, chamar `checkPhoneExistsOnWhatsApp(supabase, job.company_id, finalWa)` e gravar `whatsapp_valid` / `whatsapp_checked_at` / `whatsapp_check_error` exatamente como antes (rótulos `valid`, `not_on_whatsapp`, `no_phone`, `error: …`).

Nenhuma outra function precisa mudar — `cadence-executor`, `cadence-agent-decide`, `send-outbound-message`, `slot-expiry-followup` e `inbound-webhook` já usam os aliases `getZApiConfig` / `sendWhatsAppViaZApi` que hoje apontam para Hook7.

## 3. Ajuste cosmético em `src/components/LeadDetailContent.tsx`

Nos tooltips das badges (linhas 288 e 293), substituir "validado via Z-API" por "validado via WhatsApp (Hook7)". Sem mudança de lógica.

## Fora de escopo

- Não remover a integração Z-API antiga do banco/UI (isso é uma limpeza maior; aqui só desativamos o uso na verificação).
- Não mexer no dialog do Hook7 nem nos edge functions de envio (já migrados).
- Backfill de leads antigos com `whatsapp_valid = null` não é feito automaticamente — só novos jobs de enriquecimento passam pela nova checagem.
