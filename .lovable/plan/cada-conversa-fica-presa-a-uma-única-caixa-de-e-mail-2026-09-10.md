# Cada conversa fica presa a uma única caixa de e-mail

## O que está acontecendo (confirmado nos dados)

Na Qualé há duas caixas conectadas: roger@revistaquale.com.br (conectada primeiro) e andrea@revistaquale.com.br. A cadência ativa aponta corretamente para a Andrea.

Na conversa analisada, as mensagens iniciais saíram pela Andrea, mas duas respostas aprovadas depois saíram pelo Roger. A partir daí o lead passou a responder para os dois — a mesma resposta do lead foi registrada duas vezes, uma vinda da caixa do Roger e outra da caixa da Andrea.

Causa: quando o envio não recebe explicitamente a caixa escolhida, o sistema usa "a primeira caixa ativa da empresa" — que é a do Roger. Isso acontece nas respostas fora de cadência (aprovações sem vínculo com cadência), nas respostas automáticas da IA e nos follow-ups. Ou seja, os dois problemas relatados têm a mesma origem: um deles é o envio pela caixa errada, o outro é a consequência disso (o segundo vendedor entra na thread e passa a receber tudo).

Efeito colateral adicional: como a mesma resposta chega em duas caixas, ela entra duas vezes no aplicativo (a checagem de duplicidade hoje usa o identificador interno do provedor, que é diferente em cada caixa), o que pode gerar duas respostas da IA.

## O que vamos fazer

1. **Caixa fixa por conversa.** No momento do envio, a caixa é escolhida nesta ordem: caixa indicada explicitamente → caixa que já enviou nessa conversa → caixa da cadência em que o lead está inscrito → primeira caixa ativa (último recurso). Assim uma conversa nunca troca de remetente no meio.
2. **Respostas fora de cadência.** Quando a aprovação não tem vínculo com cadência, buscar a inscrição ativa do lead para descobrir a caixa correta antes de enviar.
3. **Resposta do lead não duplica.** Passar a identificar a mensagem recebida também pelo identificador universal do e-mail (Message-ID), para que a mesma resposta chegando em duas caixas seja registrada uma única vez.
4. **Ignorar cópias de caixas que não são a dona da conversa.** Se a resposta chegar numa caixa diferente da que conduz a conversa, ela é tratada como cópia e não dispara a IA de novo.
5. Atualizar notas de versão (beta 0.54) e o manual, explicando que cada conversa fica presa à caixa que iniciou o contato.

## Detalhes técnicos

- `supabase/functions/send-outbound-email/index.ts`: substituir a resolução atual do grant por uma cadeia: `email_grant_id` → `grant_id` do último `messages.metadata->>'grant_id'` outbound da conversa → `cadences.email_grant_id` da `cadence_enrollments` ativa do lead → grant ativo mais antigo. Validar sempre `status = active` e `company_id`.
- `supabase/functions/approval-execute/index.ts`: quando `approval.enrollment_id` for nulo, procurar `cadence_enrollments` ativa por `lead_id` para obter o `email_grant_id` (a cadeia acima já cobre, mas mantém o caminho explícito).
- `supabase/functions/email-inbound-webhook/index.ts`: gravar `rfc_message_id` da mensagem recebida (header `Message-Id`) e deduplicar por `rfc_message_id` dentro da conversa, além do `nylas_message_id` atual; se já existir a mensagem, responder `deduped` sem invocar `inbound-webhook`.
- Também aplicar a mesma dedupe antes de disparar o pipeline quando a conversa já tem um grant "dono" diferente do grant que recebeu a cópia.
- `src/lib/version.ts` para beta 0.54 e novo item em `docs/patch-logs/`.

## Fora do escopo

- Não vamos reatribuir conversas antigas que já estão com os dois vendedores na thread; a partir da correção, novas respostas seguem apenas pela caixa dona da conversa.
- Não mexeremos na escolha de caixa por lead/vendedor (round-robin) — isso seria outro recurso.
