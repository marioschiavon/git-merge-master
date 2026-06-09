## O que aconteceu

Lead Juliano respondeu **"Mudei de ideia. Nao me interesso mais pelo produto. Agradeço sua atenção."**

Dois sistemas processaram a mensagem:

1. **Pipeline de Intents** classificou como `rejection / not_interested` e disparou a regra da empresa (`intent_action_rules`), cujas ações são: `send_reply (tone=polite)`, `stop_sequence`, `disqualify_lead`.
   - `stop_sequence` e `disqualify_lead` foram executados (status=done).
   - **`send_reply` foi pulado** pelo `routeAndEnqueue` (linha 77 de `_shared/route-intent.ts`): por design, qualquer ação que gera resposta (set `REPLY_ACTIONS`) é ignorada pelo pipeline para não duplicar mensagem com o inbound-webhook legacy.

2. **`inbound-webhook` (caminho legacy)** classificou a ação como `pause` (prompt diz: "rejeição geral do produto → use pause; NÃO cancel"). O ramo `pause` (linhas 1227-1231) **apenas pausa a cadência** — não envia nenhuma mensagem. O prompt inclusive instrui a IA: *"reply_message: null se action=pause e não precisa responder"*. Resultado: nenhuma resposta sai.

A reunião foi cancelada via outra ação (`cancel_booking`) que ficou pendente desde mensagens anteriores e rodou nesse momento, daí o system message de cancelamento. Mas o agradecimento ao lead simplesmente não existe nesse fluxo.

Resposta à sua pergunta: **não é a regra de intent que silenciou** — a regra até pede send_reply. O webhook é que está configurado para nunca responder em `pause`.

## Mudança

### `supabase/functions/inbound-webhook/index.ts`

1. **Ajustar o prompt da IA** (linhas ~473 e ~542):
   - `pause`: alterar para "prospect rejeitou totalmente a abordagem/produto → pausar cadência **E enviar mensagem curta de agradecimento + porta aberta**".
   - Atualizar o exemplo do JSON: `reply_message: "mensagem para enviar ao prospect (obrigatória também em pause — agradecimento + porta aberta)"`.
   - Acrescentar regra: *"Para action=pause, reply_message DEVE ser uma mensagem curta, gentil, agradecendo a sinceridade e deixando a porta aberta para retorno futuro. Sem insistir, sem CTA de venda."*

2. **Garantir fallback no branch `pause`** (linhas 1227-1231):
   ```ts
   } else if (parsed.action === "pause") {
     if (enrollment) {
       await supabase.from("cadence_enrollments")
         .update({ status: "paused", paused_reason: "lead_rejected" } as any)
         .eq("id", enrollment.id);
     }
     if (!parsed.reply_message) {
       parsed.reply_message = "Tudo bem, agradeço muito pelo seu retorno e pelo tempo até aqui! Vou pausar nosso contato por aqui. Se mudar de ideia ou quiser conversar mais pra frente, é só me chamar. 👋";
     }
   }
   ```
   (Hoje só roda se `enrollment` existir, mesmo bug.)

### Fora de escopo
- Mudar `routeAndEnqueue` para deixar de pular `send_reply` (mexer ali corre risco de duplicar mensagem em todos os outros intents).
- Adicionar template de agradecimento configurável por empresa (pode ser feito num próximo passo).
- Alterar a regra de intent no banco.

## Resultado esperado

Lead diz "Não tenho mais interesse" → cadência pausa, reunião cancelada (já funciona) **e** o SDR responde algo como: *"Tudo bem, agradeço muito pelo seu retorno! Pausei nosso contato por aqui. Se mudar de ideia, é só me chamar. 👋"*
