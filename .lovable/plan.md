## Objetivo

Hoje o drawer de progresso na cadência (`LeadProgressDrawer`) tem apenas Cadência / Conversa / Atividades / Dados (este último é uma lista enxuta de campos). O usuário quer enxergar dentro do drawer o **cadastro completo do lead** — o mesmo conteúdo rico do painel de Leads (status, score, contatos, website, insights do prospect, proposta de valor, produtos/serviços, diferenciais, possíveis dores, social, bookings, slots, etc.).

## O que vai mudar

1. **Refatorar `LeadDetail.tsx`** para separar o `Sheet` da renderização do conteúdo:
   - Criar `src/components/LeadDetailContent.tsx` com todo o corpo atual (cabeçalho, contatos, insights, social, bookings, slot holds, atividades).
   - `LeadDetail.tsx` continua sendo o `Sheet` usado em `/leads`, mas internamente passa a renderizar `<LeadDetailContent lead={lead} />`. Nenhuma quebra para a página Leads.

2. **`LeadProgressDrawer.tsx`** — Substituir a aba atual `Dados` por uma aba **`Cadastro`** que renderiza `<LeadDetailContent lead={lead} />`, reaproveitando 100% do painel completo do lead.
   - A grade de tabs passa de `grid-cols-4` para `grid-cols-4` mantendo: **Cadência · Conversa · Atividades · Cadastro**.
   - O cabeçalho do drawer (avatar, nome, step/status/intent, botões "Abrir conversa" / "Re-testar") permanece como está — só o conteúdo da aba muda.

3. Ajustar imports não usados (`DataRow`, ícones) em `LeadProgressDrawer.tsx`.

## Fora de escopo

- Edição inline do lead dentro do drawer.
- Mudar largura do drawer (continua `sm:max-w-xl`; o conteúdo do cadastro tem `ScrollArea` próprio do drawer).
- Alterar `/leads` ou outras telas.

## Arquivos

- **Novo:** `src/components/LeadDetailContent.tsx`
- **Editado:** `src/components/LeadDetail.tsx` (vira wrapper fino do Sheet)
- **Editado:** `src/components/cadence/LeadProgressDrawer.tsx` (nova aba Cadastro)
