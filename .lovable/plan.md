# Indicações e troca de canal pelas respostas de e-mail

## Situação atual
O app já entende indicações escritas ("fala com o Carlos, carlos@empresa.com", "não sou eu, é a Andreia, 31 99999-0000"), cria o novo lead ligado a quem indicou e o coloca na cadência de indicações. Isso foi feito pensando no WhatsApp. Agora que as respostas do Gmail entram no mesmo caminho, falta cobrir bem três casos.

## Os 3 casos que vamos tratar

**1. "Fale com outra pessoa" (indicação de outro e-mail)**
- Ex.: "Quem cuida disso é o João, joao@empresa.com".
- O app cria o João como novo lead (mesma empresa de quem indicou), agradece quem indicou e tira essa pessoa da cadência.
- A primeira mensagem para o João sai **pelo Gmail da mesma caixa** que conversava com quem indicou, citando a indicação ("O Fulano me passou seu contato...").

**2. "Me chama no WhatsApp" (o mesmo lead, outro canal)**
- Ex.: "Prefiro falar pelo Whats, 31 98888-7777".
- Isso **não é indicação**: é o mesmo lead mudando de canal. O app salva o número no próprio lead, verifica se tem WhatsApp e continua a conversa por lá, avisando no e-mail ("Perfeito, te chamo no WhatsApp").
- Se não houver WhatsApp conectado na empresa, ou o número não tiver WhatsApp, a conversa segue no e-mail e o caso vai para a Inbox humana.

**3. "Fala com meu sócio no WhatsApp" (indicação por telefone)**
- Ex.: "Meu sócio Pedro cuida disso, 31 97777-6666".
- O app cria o Pedro como novo lead, verifica o WhatsApp e manda a primeira mensagem **por WhatsApp**, citando a indicação. Sem WhatsApp válido, tenta e-mail (se informado); sem nenhum, registra no histórico e avisa na Inbox humana.

## Regras de segurança (valem para os 3)
- Respeita aprovações: se a empresa usa aprovação, as mensagens vão para **Aprovações** antes de sair.
- Respeita a lista **"Não prospectar"**: indicado de organização protegida não é abordado.
- Não duplica: se o e-mail/telefone já é de um lead em conversa, só registra a indicação no histórico, sem nova abordagem.
- Indicado vindo por e-mail fica com a mesma regra de "caixa dona da conversa" já usada no Gmail.
- Assinaturas de e-mail (telefone no rodapé) **não** contam como indicação nem troca de canal — só o que está no texto da resposta.

## Como você vai ver no app
- Na conversa de quem indicou: nota "Indicou João (e-mail)" ou "Pediu para continuar no WhatsApp".
- No novo lead: origem "Indicação", com nome de quem indicou.
- Em Acompanhamento: o indicado aparece na cadência de indicações.

## Teste ponta a ponta (com você)
Usando o lead "Mario Teste Gmail":
1. Você responde o e-mail indicando outro e-mail seu → confirmamos novo lead + e-mail citando a indicação.
2. Você responde pedindo WhatsApp com seu número → confirmamos mensagem no WhatsApp.
3. Você indica um "sócio" com outro número → confirmamos novo lead abordado no WhatsApp.

## Detalhes técnicos
- `entity-extractor.ts`: novo sinal `channel_switch` (mesmo lead, "me chama/prefiro no whats/zap", "meu número é") separado de `referral_contact`; reconhecer "meu sócio/sócia/colega/gerente" como indicação; ignorar telefones/e-mails do bloco de assinatura (aplicar sobre o texto já sem citação, cortando após "--"/linha de assinatura).
- `policy-engine.ts`: rota `channel_switch` → atualizar `leads.whatsapp/phone`, disparar verificação Hook7, criar/usar conversa WhatsApp e responder curto no canal de origem; testes no `policy-engine_test.ts` e `entity-extractor_test.ts`.
- `execute-action.create_new_contact`: escolher canal da primeira mensagem (telefone com WhatsApp confirmado → WhatsApp; senão e-mail), checar `is_lead_protected`/organização protegida, deduplicar por e-mail/telefone normalizado (`phone-br.ts`), e para envio por e-mail gravar `grant_id` da caixa do indicante para manter a stickiness.
- Garantir que `gmail-inbound-poll` → `inbound-webhook` leve `source: "email"` até o `sdr-agent` (já ocorre) para a resposta ao indicante sair pelo Gmail.
- Atualizar manual (06/13), patch log e versão beta.
