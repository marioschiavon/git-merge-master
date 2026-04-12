
## Corrigir repetição de horários após o prospect rejeitar os slots

### Problema
O backend cancela os horários atuais e busca novos, mas o `calcom-slots` escolhe os slots de forma determinística. Como os horários cancelados voltam a ficar disponíveis no calendário, ele acaba devolvendo as mesmas opções de novo.

Também há um detalhe extra: no `inbound-webhook`, quando a resposta é `reject_slots`, a metadata `offered_slots` continua podendo guardar os slots antigos em vez dos novos, o que mantém o contexto errado para a próxima rodada.

### O que vou ajustar
1. **Ensinar o `calcom-slots` a ignorar horários já oferecidos**
   - Adicionar um parâmetro opcional `exclude_datetimes`.
   - Filtrar esses horários antes de montar as próximas opções.
   - Aplicar isso tanto no fluxo normal quanto no fallback de alternativas do `check_datetime`.

2. **Passar os horários rejeitados no `inbound-webhook`**
   - No fluxo `reject_slots`, enviar para o `calcom-slots` os horários dos `heldSlots` que o prospect acabou de recusar.
   - Se os holds já tiverem expirado, usar `lastOfferedSlots` como fallback para não repetir a última oferta.

3. **Salvar os slots realmente enviados**
   - Depois que o `calcom-slots` retornar novas opções, atualizar o array local usado na metadata.
   - Assim `offered_slots` passa a refletir os horários novos, não os cancelados.

4. **Alinhar o contexto da IA com BRT**
   - Trocar a montagem manual das datas no `inbound-webhook` para usar o helper de formatação em BRT.
   - Isso evita a IA “enxergar” horários em UTC no contexto interno.

### Detalhe técnico
- Comparar exclusões por timestamp UTC normalizado, não por texto bruto.
- Filtrar antes da seleção do “slot do dia”, para que o sistema pegue outra opção real daquele dia quando existir.
- Se, após excluir os rejeitados, não houver 2 opções novas, o fluxo deve oferecer 1 horário novo ou cair no link de agendamento, nunca repetir os anteriores.

### Arquivos
- `supabase/functions/inbound-webhook/index.ts`
- `supabase/functions/calcom-slots/index.ts`

### Escopo
- 2 edge functions
- Sem mudanças de banco
- Sem mudanças de UI

### Resultado esperado
- Primeira oferta: A / B
- Prospect: “nenhum desses”
- Segunda oferta: C / D
- O sistema não volta a mandar A / B na resposta seguinte
