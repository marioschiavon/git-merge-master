

## Preview de Mensagens por Lead na Cadência

### O que será feito
Ao clicar no nome de um lead na aba Leads da cadência, abre um Dialog mostrando como cada step ficaria para aquele lead específico. Steps com Customização Inteligente ativada terão a mensagem gerada pela IA automaticamente. O usuário pode revisar e editar cada mensagem antes de enviar.

### Detalhes técnicos

**1. Nova Edge Function: `preview-cadence-messages`**
- Recebe `cadence_id` e `lead_id`
- Busca todos os steps da cadência, knowledge da empresa, e lead_insights
- Para cada step com `smart_customization = true`: chama a IA (mesmo prompt do executor) para gerar a mensagem personalizada
- Para steps com `smart_customization = false`: retorna o template original com `{{nome}}` substituído
- Retorna array de `{ step_order, channel, subject, message, smart_customization, template_original }`

**2. Novo componente: `LeadMessagePreview`**
- Dialog que abre ao clicar no nome do lead na lista de enrollments
- Mostra cada step em cards sequenciais com:
  - Número do step, canal, delay
  - Badge "✨ Customizado com IA" se smart_customization ativo
  - Textarea editável com a mensagem gerada/template
  - Campo de assunto editável (para email)
- Botão de loading enquanto a IA gera as mensagens
- Botão "Regenerar" por step individual

**3. UI no `CadenceDetail.tsx`**
- Nome do lead na lista de enrollments vira clicável (cursor pointer, underline on hover)
- Ao clicar, abre o Dialog de preview passando `leadId` e `cadenceId`

**4. Hook: `usePreviewCadenceMessages`**
- Mutation que invoca a edge function `preview-cadence-messages`
- Retorna as mensagens geradas para exibição no dialog

### Escopo
- 1 nova edge function (`preview-cadence-messages`)
- 1 novo componente (`LeadMessagePreview.tsx`)
- 1 novo hook (`usePreviewCadenceMessages`)
- 1 componente atualizado (`CadenceDetail.tsx` — nome clicável)

### Resultado
O SDR pode clicar no nome do lead, ver exatamente como cada mensagem ficaria (com ou sem personalização IA), editar se necessário, e ter confiança antes de executar a cadência.

