## Problema

A página `/cadences/dashboard` mostra "Nenhum lead encontrado" mesmo havendo lead em cadência.

Confirmei na base: existem 6 cadências, mas só a cadência **"Inteligente"** tem 1 enrollment. As outras 5 estão zeradas. O seletor da página faz default para `cadences[0]`, que é **"Inteligente 2"** (mais recente, sem enrollments). Por isso a tabela aparece vazia — a cadência selecionada por padrão não é a que tem o lead.

## Plano

Ajustar somente o frontend (`src/pages/CadencesDashboard.tsx` + `src/hooks/useCadences.ts` se necessário) para:

1. **Mostrar contagem de leads no seletor de cadência**
   - No dropdown, exibir o nome da cadência com um badge/contagem: `Inteligente (1)`, `Inteligente 2 (0)`, etc.
   - Para isso, buscar a contagem de `cadence_enrollments` por cadência (uma única query agregada) e juntar ao `useCadences`.

2. **Default inteligente**
   - Em vez de selecionar `cadences[0]`, selecionar a primeira cadência com `enrollments > 0`. Se nenhuma tiver, manter `cadences[0]`.

3. **Mensagem vazia mais clara**
   - Quando a cadência selecionada tiver 0 enrollments, trocar "Nenhum lead encontrado." por algo como "Esta cadência ainda não tem leads matriculados. Use Leads → Adicionar à cadência."

Sem mudanças no backend, RLS ou nas edge functions.

## Validação

- Abrir `/cadences/dashboard`: deve abrir já com **"Inteligente (1)"** selecionada e o lead visível.
- Trocar para "Inteligente 2" deve mostrar a nova mensagem explicativa.