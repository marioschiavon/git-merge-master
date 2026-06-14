# Indicação (referral) ponta-a-ponta + bloqueio de follow-up de slots após encerramento

## Contexto

Na conversa de `eu@julianocarneiro.com.br` (`a6ba77a3-…`) o lead disse "Voce pode entrar em contato com o Carlos", mandou `Familiarochacarneiro@gmail.com` e autorizou ("Pode dizer que eu indiquei"). O agente respondeu cordialmente, mas:

1. Nenhum novo lead foi criado no banco; nenhuma `lead_action_queue` de outreach foi enfileirada. O Carlos nunca foi contatado.
2. ~1h40 depois, slots ainda em `held` da conversa cancelada expiraram, `expire-slot-holds` disparou `slot-expiry-followup` e o lead recebeu uma mensagem oferecendo dois novos horários, mesmo já tendo se desligado por indicação.

## Causa-raiz

- `_shared/policy-engine.ts` (case `referral`) só devolve diretriz textual. Não força tool nem produz ação. As tools `create_new_contact` e `mark_current_contact_as_referrer` existem em `execute-action/index.ts` mas o `sdr-agent` não as expõe nem as enfileira.
- `expire-slot-holds/index.ts` despacha follow-up para QUALQUER hold expirado, sem consultar `leads.referral_stage` / `status` / `intent`. Após referral ou `not_interested`, holds remanescentes ainda geram mensagem.

## Mudanças

### 1. `supabase/functions/_shared/policy-engine.ts`
- Estender `PolicyInputs.entities` com `referral_contact: { name?: string; email?: string; phone?: string; permission_to_mention?: boolean } | null`.
- No `case "referral"`:
  - Se `referral_contact` tem ao menos `email` ou `phone` → `forced_tool: "create_new_contact"`, `forced_args` com os campos extraídos, stage `referral_provided`, e `response_directive` instruindo o LLM a (a) confirmar curto e (b) NÃO oferecer agenda. Também sinalizar (via campo extra na decisão, ex.: `post_actions: ["mark_referrer", "release_slot_holds"]`) que o sdr-agent deve, após o tool, marcar o lead atual como indicante e liberar holds.
  - Sem contato ainda → manter directive atual (pedir contato + permissão), mas adicionar `release_slot_holds` em `post_actions` (já não é mais um lead "agendando").

### 2. `supabase/functions/_shared/entity-extractor.ts`
- Adicionar extrator determinístico de e-mail/telefone na inbound: regex de e-mail e telefone BR (`/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i`, `/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/`).
- Detectar autorização explícita ("pode dizer que eu indiquei", "pode mencionar meu nome", "use meu nome") → `permission_to_mention: true`.
- Popular `referral_contact` quando algum desses sinais existir; nome opcional (capturar via padrão "fale com X" / "procurar o X").
- Cobertura em `_shared/entity-extractor_test.ts`.

### 3. `supabase/functions/sdr-agent/index.ts`
- Adicionar tools `create_new_contact` e `mark_referrer` à lista `tools[]` e ao `execTool`, delegando para `execute-action` (`create_new_contact`, `mark_current_contact_as_referrer`).
- Suportar `forced_tool="create_new_contact"`: execução determinística (igual ao bloco de `book_slot`).
- Implementar `post_actions` da política: depois do tool forçado e antes de finalizar, executar `mark_current_contact_as_referrer` e `release_slot_holds` (UPDATE em `slot_holds` para `status='released'` em todos os holds `held` do lead).
- Após `create_new_contact`, enfileirar outreach para o novo lead: inserir em `lead_action_queue` (`action_type='send_first_outreach'`, `params={ source: 'referral', referrer_lead_id }`) OU, se a empresa tem cadência ativa default, criar `cadence_enrollments` no novo lead (verificar padrão usado em outros pontos antes de decidir — preferir o caminho já existente).
- Garantir que `intent="referral"` reflita no banco: `leads.status='qualified'` permanece (já feito por `mark_current_contact_as_referrer`); registrar `lead_activities` "🔁 Indicação processada → novo lead {id}".

### 4. `supabase/functions/expire-slot-holds/index.ts`
- Antes do `invoke("slot-expiry-followup")`, carregar `leads.referral_stage, status` do lead. Pular o follow-up (apenas marcar holds como `expired`) quando:
  - `referral_stage IN ('is_referrer','pending_outreach','aguardando_encaminhamento_interno')`, ou
  - `status IN ('disqualified','not_interested','won','lost')`, ou
  - Não existe `cadence_enrollments` ativo (`status='active'`) para o lead.
- Logar o motivo em `lead_activities` (type `system`).

### 5. `supabase/functions/slot-expiry-followup/index.ts`
- Reaplicar o mesmo guarda no início (defesa em profundidade contra invocações diretas / `intent-cron`). Retornar `{ skipped: true, reason }` sem enviar mensagem.

### 6. Testes
- `_shared/policy-engine_test.ts`: cobrir `referral` com e sem `referral_contact`.
- `_shared/entity-extractor_test.ts`: e-mail, telefone, permissão, combinação.
- Smoke test invocando `slot-expiry-followup` para um lead `is_referrer` → deve retornar `skipped`.

## Fora do escopo
- Não vou criar fluxo de aprovação humana antes de contatar o indicado (assumido que `create_new_contact` + outreach automático segue o padrão do produto).
- Não vou alterar o template da primeira mensagem ao indicado — uso a cadência/template existentes.

## Risco
Médio. Mexe em referral (caminho relativamente novo) e em cron de expiração (em produção). Mitigação: guards conservadores (pulam follow-up só com sinais claros de encerramento), e testes Deno cobrindo os novos branches.


## Status
Implementado e deployado. Testes Deno passando (14 policy + 5 entity).
