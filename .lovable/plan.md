# Ajuste de layout da coluna Nome em Leads

## Problema
Na tabela de leads, a célula do nome empilha nome + ícones de canal + até três selos (Empresa, Agente, prontidão) numa única linha flexível. Quando a coluna aperta:

- o ícone do WhatsApp (uma `<img>`) é comprimido e fica achatado, porque não tem proteção contra encolher nem `object-contain`;
- o selo "🤖 Agente" quebra a linha entre o emoji e a palavra, deixando um em cima do outro.

## Solução proposta
Manter o robô, mas impedir a quebra e o achatamento (mais simples e sem perder informação visual):

1. **Ícone do WhatsApp** (`src/components/lead/ChannelBadges.tsx`): adicionar `shrink-0 object-contain` à `<img>` e ao wrapper, garantindo proporção fixa.
2. **Selos** (`src/pages/Leads.tsx`): aplicar `shrink-0 whitespace-nowrap` nos selos Empresa / Agente / prontidão, para que nunca quebrem internamente.
3. **Linha do nome**: nome com `truncate` e `min-w-0`, selos com `flex-wrap` controlado — assim o que cede é o texto do nome, não os selos.
4. **Coluna Nome**: definir uma largura mínima (`min-w-[220px]`) no `TableHead` correspondente para reduzir o aperto em telas médias.

Alternativa, caso prefira mais limpo: trocar "🤖 Agente" por só o selo com texto "Agente" (sem emoji) e mover o robô para o tooltip. Posso aplicar essa variante se quiser.

## Arquivos afetados
- `src/components/lead/ChannelBadges.tsx`
- `src/pages/Leads.tsx`

Apenas mudanças visuais; nenhuma lógica de dados é alterada.
