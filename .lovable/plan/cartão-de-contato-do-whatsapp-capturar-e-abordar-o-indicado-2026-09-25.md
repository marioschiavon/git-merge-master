# Cartão de contato do WhatsApp: capturar e abordar o indicado

## O que encontrei (Qualé)
- Hoje o app só lê texto, legenda de foto/vídeo e respostas de botões. O **cartão de contato é descartado**: não é salvo na conversa, a IA nunca o vê e ninguém é cadastrado.
- Na Qualé isso aconteceu de fato. Ex.: Ouvidoria de Altamira (22/09) escreveu "encaminharemos o contato do setor responsável" e mandou o cartão, mas no histórico só aparece o texto. Itatira (22/09) e outras prefeituras seguem o mesmo padrão.
- O fluxo de indicação já existe (a IA cria o contato indicado e manda a 1ª mensagem), mas só funciona quando o número vem escrito no texto.

## Como vamos resolver
1. **Ler o cartão**: quando chegar um cartão (um ou vários), extrair nome, telefone(s) e e-mail. Salvar na conversa como "📇 Contato compartilhado: Nome — +55...", para aparecer no histórico e na Caixa de entrada.
2. **Cadastrar o indicado automaticamente**: criar (ou reaproveitar, se o número já existir) um contato na mesma empresa do lead, com nome, telefone em formato Hook7 e marcação "indicado por <lead original>". O cargo e o setor ficam como referência (ex.: "Secretaria de Desenvolvimento Econômico").
3. **Encerrar o contato original**: pausar a cadência do contato que enviou o cartão e registrar no histórico "indicou Fulano".
4. **Abordar o indicado**: a IA cria uma 1ª mensagem citando a indicação ("A Ouvidoria de Altamira me passou seu contato…") e usa a mesma conexão de WhatsApp do lead original. Essa mensagem **respeita a aprovação humana**: se a empresa usa aprovação (Qualé usa), ela vai para Aprovações antes de sair.
5. **Agradecer ao original**: resposta curta ao contato que mandou o cartão ("Obrigado, vou falar com ele(a)!"), também sujeita à aprovação.
6. **Casos especiais**:
   - Cartão sem telefone → só registra no histórico e avisa na Caixa de entrada.
   - Número igual ao do próprio lead ou de um contato já em conversa → não duplica e não reaborda.
   - Número sem WhatsApp → cadastra, marca como "sem WhatsApp" e não envia.
7. **Recuperar o que já foi perdido**: não conseguimos recuperar os cartões antigos (o WhatsApp não os reenviou). Vou listar as conversas da Qualé em que o lead falou em "encaminhar contato" nos últimos 30 dias, para o time pedir o número de novo manualmente.

Manual (03a e 13) e patch log atualizados; versão sobe para beta 0.60.

## Detalhes técnicos
- `whatsapp-webhook`: tratar `contactMessage` e `contactsArrayMessage`, fazer o parse de `vcard` (FN, TEL com `waid`, EMAIL, ORG, TITLE), normalizar com `_shared/phone-br.ts`; guardar em `messages.metadata.shared_contacts`.
- Novo helper `_shared/shared-contact.ts`: faz a busca/criação do lead indicado (`source='referral'`, `referral_source_lead_id`), reutilizando a mesma lógica de criação do bloco `action === "referral"` em `sdr-agent` (extraída para função compartilhada, sem duplicar código).
- A 1ª mensagem passa pelo `hitl-gate` e usa `enqueueWhatsAppSend` com a instância da conversa original.
- Classificador de intenção: mensagem com cartão → fast-path `referral` (confiança 0,95).
- Adicionar `lead_activities` tipo `referral_shared_contact` no lead original e no indicado.
