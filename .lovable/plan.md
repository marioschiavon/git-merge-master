## Objetivo

Quando um lead novo for criado por indicação (`source='referral'`, com `referral_source_lead_id` preenchido), ele entra numa **cadência marcada como `kind='referral'`** em vez da cadência padrão — com mensagens que citam quem indicou e o contexto da indicação, e priorizando WhatsApp.

## Mudanças

### 1. Schema (migration)
- `public.cadences` ganha coluna `kind text NOT NULL DEFAULT 'outbound'` com CHECK em `('outbound', 'referral')`.
- Índice parcial `idx_cadences_referral` em `(company_id, status)` onde `kind = 'referral'` (para lookup rápido da ativa).

### 2. UI — editor de cadência (`src/components/CadenceDetail.tsx` / lista em `src/pages/Cadences.tsx`)
- Novo seletor "Tipo da cadência": **Outbound padrão** | **Indicações (referral)**.
- Badge "Indicações" na listagem.
- Hint no editor de step: "Você pode usar `{{referrer_name}}` e `{{referral_context}}` nos templates desta cadência."

### 3. Inscrição automática — `supabase/functions/execute-action/index.ts` (`create_new_contact`)
Logo após inserir o novo lead, se existir cadência ativa com `kind='referral'` na mesma `company_id`:
- Cria `cadence_enrollments` (status `active`, `current_step=1`, `next_execution_at=now()` ou conforme `delay_days` do primeiro step) apontando para essa cadência.
- Pula a inscrição padrão (sinalizar via `lead.source='referral'` para o `enrich-lead` não enrolar de novo na default).
- Activity log: "Inscrito na cadência de indicações: {nome}".

### 4. Pular default cadence para referrals — `supabase/functions/enrich-lead/index.ts`
No bloco `generate_message` (linhas 463-483), quando `lead.source === 'referral'` e já existir enrollment ativo do tipo referral, não criar enrollment na `default_cadence_id`.

### 5. Renderização com contexto do indicante — `supabase/functions/cadence-executor/index.ts`
Antes do prompt da IA (≈ linha 383), quando a cadência for `kind='referral'`:
- Carregar o indicante via `leads` join em `referral_source_lead_id` → `referrer_name`, `referrer_company`, `referrer_role`.
- Carregar `referral_context` do próprio lead.
- Adicionar bloco no prompt:
  ```
  === INDICAÇÃO ===
  Este lead foi indicado por {referrer_name} ({referrer_company}).
  Contexto da indicação: {referral_context || "—"}
  REGRAS OBRIGATÓRIAS:
  - Abra mencionando "{referrer_name} me passou seu contato" (ou variação natural).
  - Cite o contexto da indicação se houver, pra dar legitimidade.
  - Tom mais quente e direto que outbound frio — a indicação já te aproxima.
  ```
- Pré-interpolar `{{referrer_name}}` e `{{referral_context}}` no `currentStep.template` antes de mandar pro LLM (fallback: se variável não existir, troca por string vazia).

### 6. Canal padrão WhatsApp-first
- Na cadência seed que sugerirmos no doc, primeiro step `channel='whatsapp'`, segundo step `channel='email'` como fallback.
- Não forçar override no executor — quem define o canal é o step. Apenas garantir que o template seed venha com WhatsApp no step 1.

### 7. Tests
- `execute-action_test.ts` (novo): create_new_contact com referral cadence ativa → cria enrollment correto; sem referral cadence ativa → não cria enrollment (fica pro fluxo normal).
- Atualizar `useCadences.ts` types após regenerar.

## Verificação
- `supabase--migration` para schema.
- Deploy `execute-action`, `enrich-lead`, `cadence-executor`.
- Criar cadência de teste marcada como referral, criar referral via SDR, conferir no `/cadences` que o lead aparece com mensagem citando o indicante.

## Fora de escopo
- Multi-cadência referral (1 ativa por empresa basta agora).
- Variáveis `{{referrer_company}}` / `{{referrer_role}}` nos templates (ficam disponíveis só via prompt da IA, não como placeholders, conforme sua escolha).
