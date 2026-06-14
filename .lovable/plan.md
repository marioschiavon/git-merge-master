# Ajustes no fluxo de Referral

Três correções no fluxo de indicações para resolver o que apareceu na conversa.

## 1. SDR pede WhatsApp quando o lead de indicação responde por email

**Problema:** lead de indicação respondeu o primeiro email e o SDR não pediu o WhatsApp. Como WhatsApp é o canal preferencial da cadência de indicações, perder essa chance trava o fluxo.

**Solução** — em `supabase/functions/sdr-agent/index.ts`, no system prompt:

- Adicionar uma regra dedicada ao contexto referral: se `lead.source === 'referral'` E `!lead.whatsapp` E o canal atual da conversa é `email` E ainda não houve pedido prévio de WhatsApp (checar `lead_activities` ou `lead_memory.facts.whatsapp_asked`), o SDR DEVE, na próxima resposta, pedir educadamente o número de WhatsApp ("para agilizar a conversa") junto com a resposta normal.
- Após pedir, chamar `update_lead_facts({ facts: { whatsapp_asked: true } })` para não repetir.
- Quando o lead responder com número, o SDR já tem a tool de extrair entities — garantir que `whatsapp` extraído é salvo no `leads.whatsapp` (verificar branch de update; se faltar, adicionar).

## 2. Cadência de indicações começa pelo email quando lead não tem WhatsApp

**Problema atual:** a cadência referral tem step 1 = WhatsApp, step 2 = email. Hoje o `cadence-executor` só pula o step de WhatsApp se `lead.whatsapp_valid === false` (validação explícita). Para lead novo de indicação, `whatsapp` é `null` e `whatsapp_valid` é `null` — o step não é pulado, mas também não há número pra enviar, então o envio falha silenciosamente ou fica preso.

**Solução** — em `supabase/functions/cadence-executor/index.ts`, na verificação do step:

- Estender o skip atual para também pular quando `currentStep.channel === 'whatsapp'` E `!lead.whatsapp && !lead.phone` (sem número algum cadastrado). Log: `skip_reason: 'no_whatsapp_number'`.
- Quando pula, avança para o próximo step imediatamente (sem aguardar `delay_days`) para que o email saia logo — definir `next_execution_at = now()` em vez de `now + delay_days` quando o motivo do skip é falta de canal.
- Mesma regra para step `whatsapp` quando lead só tem email: pula e cai no email.

Resultado: lead de indicação sem WhatsApp recebe direto o email (step 2) sem ficar parado.

## 3. Cadastro do indicado guarda nome correto e nome do indicante

**Problema:** ao criar o lead via `create_new_contact`, o nome às vezes vinha como email. Já existe `deriveNameFromEmail` que limpa isso, mas o nome do indicante não fica acessível direto no novo lead (só via join em `referral_source_lead_id`).

**Solução** — em `supabase/functions/execute-action/index.ts` no handler `create_new_contact`:

- Reforçar validação de nome: se `name` parecer email (contém `@`) OU for igual ao email OU vazio, sempre usar `deriveNameFromEmail(email)`. Já está parcial — endurecer o check.
- Adicionar campos snapshot no insert do novo lead:
  - `referrer_name` = `referrer?.name`
  - `referrer_company` = `referrer?.company_name`
- Atualizar a activity log para sempre mostrar `"Indicado por {referrer.name} ({referrer.company_name})"`.

**Migração necessária:** adicionar colunas em `public.leads`:
```sql
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS referrer_name text,
  ADD COLUMN IF NOT EXISTS referrer_company text;
```

Atualizar `cadence-executor` para usar esses snapshots quando interpolar `{{referrer_name}}` (fallback: join atual).

## Arquivos alterados

- `supabase/migrations/<novo>.sql` — adiciona `referrer_name`, `referrer_company` em `leads`.
- `supabase/functions/execute-action/index.ts` — endurece nome, salva snapshot do indicante.
- `supabase/functions/cadence-executor/index.ts` — skip de step WhatsApp quando lead não tem número, avanço imediato.
- `supabase/functions/sdr-agent/index.ts` — regra no system prompt para pedir WhatsApp em referral via email.

## Fora de escopo

- Reordenar steps da cadência automaticamente (continua skip simples).
- UI para editar manualmente o `referrer_name` snapshot (vem só do create).
