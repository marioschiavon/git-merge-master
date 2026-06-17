## Causa raiz

Investigando o lead recém-criado (`Familiarochacarneiro`, vindo da indicação da Dra. Claudia), os logs do `sdr_agent_runs` mostram exatamente o que aconteceu:

**Turn 1** — inbound "Seria com a Dra. Claudia":
- O regex extraiu corretamente `referral_contact.name = "Dra Claudia"`.
- O bloco determinístico em `sdr-agent` persistiu `referral_pending_name = "Dra Claudia"` em `lead_memory.facts`.
- **Logo depois**, a LLM chamou por conta própria `update_lead_facts({ facts: { referral_contact_asked: true, referral_pending_name: null } })` — sobrescrevendo o nome que acabamos de salvar com `null`.

**Turn 2** — inbound "Tenho o email Familiarochacarneiro@gmail.com":
- Entities tem só `email` (sem nome — esperado).
- Hidratação tentou ler `referral_pending_name` → encontrou `null` → não hidratou.
- Policy montou `forced_args.name = rc.email` (fallback `?? rc.email`) → passou o e-mail como nome para `create_new_contact`.
- `execute-action` detectou que `name === email` e caiu no `deriveNameFromEmail` → "Familiarochacarneiro".

Resumo: o nome estava certo no regex E na mensagem que a LLM escreveu ("Vou entrar em contato com a Dra. Claudia"), mas o cadastro do lead saiu errado porque a LLM apagou nosso estado interno.

## Correção

Mudanças cirúrgicas, sem mexer em schema, frontend ou design.

### 1. `supabase/functions/sdr-agent/index.ts` — proteger chaves internas

No handler do tool `update_lead_facts` (linha ~418), filtrar um conjunto de chaves "managed-by-system" antes do merge:

```ts
const PROTECTED_FACT_KEYS = new Set([
  "referral_pending_name",
  // espaço pra outras chaves internas se aparecerem
]);
const incoming = (args.facts ?? {}) as Record<string, unknown>;
const facts: Record<string, unknown> = {};
for (const [k, v] of Object.entries(incoming)) {
  if (PROTECTED_FACT_KEYS.has(k)) continue; // ignora silenciosamente
  facts[k] = v;
}
```

Isso impede a LLM de mexer (zerar, sobrescrever, "limpar") em campos que o pipeline determinístico controla. As demais chaves (`whatsapp_asked`, `whatsapp`, `phone`, `referral_contact_asked`, etc.) continuam funcionando exatamente como hoje.

### 2. `supabase/functions/_shared/policy-engine.ts` — não usar e-mail como nome

No branch `referral` com `hasContact === true` (linhas ~370-393), só passar `name` em `forced_args` quando ele realmente for um nome (não cair em e-mail/telefone como fallback):

```ts
const args: Record<string, unknown> = {};
if (rc!.name) args.name = rc!.name;
if (rc!.email) args.email = rc!.email;
if (rc!.phone) args.phone = rc!.phone;
```

Assim, se o nome não estiver disponível, `execute-action.create_new_contact` já faz o tratamento certo (deriva do e-mail, ou "Indicação sem nome" como último recurso) — sem nunca receber um e-mail "disfarçado de nome".

### 3. Teste

Adicionar caso em `entity-extractor_test.ts` (ou um teste novo bem curto pro handler) que documenta o contrato: `update_lead_facts({ referral_pending_name: null })` NÃO deve sobrescrever o valor persistido. Suficiente um teste de unidade do filtro.

## Por que não usar a LLM pra extrair o nome aqui

O fallback LLM (`extract-referral-name`) já existe, mas no Turn 2 ele não roda porque o regex não detectou contexto de nome ("Tenho o email …" só tem e-mail, sem sinal de "Dra"/"fala com"/etc.) — e a LLM sozinha não tem o histórico aqui. O caminho correto é o que já existia: persistir o nome do Turn 1 e hidratar no Turn 2. O bug era simplesmente a LLM sobrescrevendo o estado.

## Fora de escopo

- Não muda o regex/extractor.
- Não muda o `extract-referral-name`.
- Não muda nada de UI, schema, cadência ou aprovações.
- Não toca em outros campos de `facts` que a LLM legitimamente atualiza.
