## Diagnóstico do caso Juliano

- **Lead:** `Juliano` — tem WhatsApp `+5511976531515`, **NÃO tem e-mail**.
- **Decisão do agente às 15:05** (`cadence_agent_decisions`): `action=send`, `channel=email`, subject *"GroomerGenius: Inovação para clínicas veterinárias…"*.
- **Justificativa registrada pela IA:** *"Juliano não respondeu às últimas três tentativas pelo WhatsApp. Como o WhatsApp é o canal preferencial, mas não houve resposta, vou tentar o e-mail…"* — ou seja, a IA ignorou que o lead não tem e-mail e ignorou as respostas inbound que existiram.
- **O que aconteceu de fato em `cadence-agent-decide` (linhas 622-657):**
  - Branch `email && lead.email` → falso (lead sem e-mail).
  - Branch `whatsapp && phone` → falso (canal era email).
  - Cai no `else` final: `sendAction = "failed"`, `delivery_error = "Lead sem contato para canal email"`. **Nenhuma linha em `messages`. Nada saiu.**
  - Mesmo assim, a `lead_activities` é gravada como *"🤖 IA enviou (email/new_info) – tentativa 4"*, sem refletir a falha.
  - `next_execution_at` é empurrado para +72h, queimando uma tentativa.

Ou seja: o agente nunca deveria ter escolhido e-mail, e quando escolheu errado o sistema não fez fallback nem reportou falha corretamente.

## Plano de correção

### 1. Guardrail determinístico de canal (em `cadence-agent-decide/index.ts`)

Logo após a IA retornar a decisão (e após o normalize de `allowed_channels`, ~linha 488), forçar:

```text
- Se decision.channel === "email" e !lead.email → trocar para "whatsapp" se houver whatsapp/phone; senão action="stop", stop_reason="no_contact".
- Se decision.channel === "whatsapp" e !(lead.whatsapp || lead.phone) → trocar para "email" se houver e-mail; senão action="stop", stop_reason="no_contact".
```

Esse guardrail é **autoritativo** — não depende do LLM acertar. Registrar no `rationale` que houve override (ex.: *"[override] canal trocado de email→whatsapp porque lead sem e-mail"*).

### 2. Endurecer o prompt (mesmo arquivo, bloco `channelNote` ~linhas 219-226)

- Quando `hasEmail === false`: adicionar bullet **"PROIBIDO: o lead NÃO tem e-mail. NUNCA escolha channel=email, independente do número de tentativas no WhatsApp."**
- Quando `hasWhatsapp === false`: simétrico para WhatsApp.
- Também passar `hasEmail`/`hasWhatsapp` explícitos no contexto do lead (hoje vem só `lead.email || "N/A"`).

### 3. Log honesto de atividade (linhas 660-669)

Trocar a descrição em função de `sendAction`:

- `sent`/`delivered` → `🤖 IA enviou (channel/hook) – tentativa N: …` (atual)
- `failed` → `⚠️ IA tentou enviar (channel/hook) – falhou: <delivery_error || zapi_error>`
- `pending_manual` → `📝 IA gerou (channel/hook) – pendente de envio manual`
- `simulated` → mantém atual

E em `type` da activity, usar `system` quando `sendAction !== sent`, para não poluir a timeline de WhatsApp/email.

### 4. Quando o envio falhar por falta de contato, não queimar tentativa

Se `sendAction === "failed"` por `delivery_error === "Lead sem contato para canal X"`:
- **Não** incrementar `current_step`.
- **Não** empurrar `next_execution_at` para +72h.
- Encerrar o enrollment com `status='completed'`, `paused_reason='no_contact_channel'`, e gravar `lead_intents_log` com `category='no_response'` + metadata explicando.

(Falha técnica de provedor — ex.: Z-API offline — continua tentando depois.)

### 5. Reconciliar o caso atual

Para o enrollment `46a009df…`:
- Reverter `current_step` (4 → 3) e `next_execution_at` para `now()` **OU** simplesmente disparar mais um manual de teste depois do fix para ver o agente escolhendo WhatsApp corretamente.

A opção mais limpa: deixar o enrollment como está, fazer o deploy do fix, e usar o botão de teste manual novamente — o agente agora será obrigado a escolher WhatsApp.

## Arquivos afetados

- `supabase/functions/cadence-agent-decide/index.ts` — guardrail, prompt, log honesto, no-burn-on-no-contact.

## Não muda

- `cadence-reengage-cron` (já corrigido na rodada anterior).
- `cadence-executor`, UI, schema.

## Validação após implementar

1. Clicar "Reengajar agora" novamente para o Juliano.
2. Conferir `cadence_agent_decisions` mais recente → `channel='whatsapp'` (não email).
3. Conferir `messages` → nova linha outbound com `delivery_status='delivered'` e `zapi_message_id` preenchido.
4. Conferir `lead_activities` → descrição reflete envio real (não mais "IA enviou" em cima de falha).
