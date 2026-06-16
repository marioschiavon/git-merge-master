## Objetivo

Permitir adicionar convidados (e-mails) no convite direto pela aba **Sugerir** do Copiloto humano, sem precisar trocar para a aba **Agendar**. Hoje, o botão "Agendar" em 1 clique nos horários já reservados não passa convidados — eles só existem na aba **Agendar**.

## O que muda (somente frontend)

Arquivo: `src/components/inbox/HumanCopilotPanel.tsx`

1. Adicionar um estado compartilhado da aba Sugerir:
   - `suggestGuests: string[]` (lista de e-mails).
2. Renderizar um bloco compacto `GuestsInput` no topo da aba **Sugerir**, visível sempre que houver `activeHolds.length > 0` ou `slots.length > 0`. Label: "Convidados extras (opcional)". Texto auxiliar: "Vão receber o convite junto com o lead."
3. Em `handleBookHold(hold)`, passar `guests: suggestGuests` no body do invoke `human-book-slot` (a função já trata `cleanGuests` e chama `calcom-add-guests` quando `hold_id` está presente).
4. Após sucesso, limpar `suggestGuests` (`setSuggestGuests([])`).

Tudo o mais permanece igual: a aba **Agendar** continua com seu próprio `GuestsInput` (`bookGuests`) para o fluxo de start ISO, e a aba **Remarcar** com `reGuests`.

## Fora de escopo

- Mudanças em `human-book-slot` ou `calcom-add-guests` (já suportam o caso).
- Persistir convidados entre sessões ou pré-preencher com base no histórico.
- Realtime para holds.

## Resultado

Operador, na aba **Sugerir**, pode digitar 1+ e-mails de convidados antes de clicar "Agendar" em qualquer hold ativo — o convite Cal.com sairá com todos os participantes em um único clique.