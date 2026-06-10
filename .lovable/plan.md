# Problema

Na indicação feita pela Jakeline (Revivere) o lead indicado foi criado, mas:

1. **WhatsApp não foi salvo** — a IA passou `referred_phone = "11951503091"` e o campo `whatsapp` ficou `null`. Só `phone` foi gravado (sem normalizar para `+55…`).
2. **O indicado nunca foi contatado** — a IA retornou `referred_channel = "email/WhatsApp"` (string composta inválida). Esse valor foi gravado direto em `leads.preferred_channel` e usado no `insert` de `conversations.channel`, que rejeita o valor → não criou conversa, não enviou e-mail nem WhatsApp.

Resultado: lead `f15defca` ficou parado em `novo_indicado`, sem conversa, sem mensagem, sem `whatsapp`.

# Correções

## 1. `supabase/functions/inbound-webhook/index.ts` — branch `referral` / `with_contact`

- Adicionar helper `pickChannel(raw, hasEmail, hasPhone)` que normaliza qualquer valor (`"email/WhatsApp"`, `"ambos"`, `null`, etc.) para **um único** canal válido: `"email"` se houver email, senão `"whatsapp"`.
- Adicionar helper `normalizeBrPhone(raw)` (reusar a lógica de `analyze-lead-website`) para devolver `+55…` válido ou `null`.
- Ao criar/atualizar o lead indicado:
  - `phone` = telefone normalizado (ou bruto se normalização falhar).
  - `whatsapp` = telefone normalizado quando for celular BR (13 dígitos com 9). Hoje está sempre `null`.
  - `preferred_channel` = resultado de `pickChannel` (apenas `email` ou `whatsapp`).
- Usar o `newChannel` normalizado no `insert` de `conversations` e na decisão entre branch e-mail / WhatsApp.
- Se `parsed.new_outreach_message` vier vazio, gerar fallback curto (“Olá {nome}, {empresa} te indicou…”) para garantir o primeiro contato.
- Branch WhatsApp: passar a enviar de fato via `sendWhatsAppViaTwilio` (hoje só grava `pending_send`), seguindo o mesmo padrão do `send-outbound-message`.

## 2. Ajuste no prompt da IA (mesmo arquivo)

No bloco que descreve `referral.referred_channel`, exigir **exatamente um** valor: `"email"` OU `"whatsapp"`. Proibir strings compostas.

## 3. Correção pontual da Jakeline (one-shot, após deploy)

Para o lead `f15defca-27c2-4be3-a284-0cccb53a006d`:

1. `UPDATE leads SET whatsapp='+5511951503091', phone='+5511951503091', preferred_channel='email'` (tem email `jakkesilva@gmail.com`).
2. Criar `conversations` (channel=`email`).
3. Chamar `gmail-send` com a primeira abordagem mencionando indicação da Jakeline (Revivere), respeitando `permission_to_mention=true`.
4. Registrar `lead_activities` (`type=referral`, “✉️ Primeira abordagem ao indicado enviada”).

# Fora de escopo

- Reescrever a detecção de indicação ou mudar como o lead `is_referrer` é marcado.
- Retroativo para outros leads antigos com `preferred_channel` inválido (posso fazer numa próxima rodada se quiser).

# Ordem de execução

1. Editar `inbound-webhook` (helpers + normalização + envio WhatsApp + prompt).
2. Deploy da função.
3. One-shot para Jakeline (update + conversa + gmail-send).
4. Verificar no painel: lead indicado com `whatsapp` preenchido e e-mail enviado.
