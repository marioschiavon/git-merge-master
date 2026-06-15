## Plano

1. **Corrigir extração do nome do indicado**
   - Melhorar o detector de referral para reconhecer frases como:
     - “Não seria comigo e sim com o Carlos”
     - “A pessoa correta chama Andreia”
     - “Nome dela/dele é ...”
   - Hoje ele capturou só o e-mail, então criou o lead como `Familiarochacarneiro` em vez de `Andreia`.

2. **Preservar nome informado antes do contato**
   - Quando o lead indicar um nome sem e-mail/telefone, salvar esse nome temporariamente na memória do lead.
   - Quando ele mandar o e-mail/telefone depois, criar o novo lead usando esse nome salvo, em vez de derivar do e-mail.
   - Se a mensagem atual trouxer um nome novo/correção (“a pessoa correta chama Andreia”), esse nome novo terá prioridade.

3. **Garantir nome do indicante no novo lead**
   - Reforçar `create_new_contact` para preencher sempre `referrer_name` com o nome do lead atual, e registrar esse valor também no log da atividade.
   - Adicionar fallback defensivo caso o indicante venha sem nome no contexto.

4. **Corrigir o registro existente**
   - Atualizar o lead já criado (`familiarochacarneiro@gmail.com`) para:
     - `name = Andreia`
     - `referrer_name = Juliano`
     - manter `referral_source_lead_id` apontando para o Juliano.

5. **Validar**
   - Adicionar/ajustar testes do extrator para os textos reais da conversa.
   - Rodar os testes das edge functions relevantes e checar o registro no banco após a correção.

## Resultado esperado

Quando o indicante disser “a pessoa correta chama Andreia. Email dela é ...”, o sistema cadastra o lead como **Andreia**, vinculado e com snapshot **Indicado por Juliano**, sem cair no nome derivado do e-mail.