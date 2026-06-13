## Diagnóstico

Lead respondeu **"Pode sim 👍🏻"** após o SDR perguntar verbalmente "podemos confirmar o agendamento para quarta-feira, 1º de Julho, às 09:00?". O agente caiu no downgrade do `confirmGate` e mandou de novo a lista de horários (os 2 holds ativos: 01/jul 09:00 e 03/jul 09:45), em vez de fazer `book_slot`. Dois motivos somados:

1. **`CONFIRMATION_REGEX` não cobre "pode sim".** O regex aceita "pode ser/marcar/agendar" mas não "pode sim", "sim", "isso", "claro", "podemos sim", emoji de polegar etc.
2. **A proposta foi verbal, não via `offer_slots`.** Como o SDR escreveu a pergunta em texto livre (sem chamar a tool `offer_slots`), `facts.offered_slots_pending` ficou vazio. Sem oferta vigente, o gate cai em `heldSlots` (que tinha 2 ISOs) e, mesmo se o lead tivesse falado "01/07", a referência seria ambígua se as 2 datas batessem — mas aqui nem isso: "pode sim" não tem referência alguma, então o gate só dependeria da confirmação explícita, que falhou pelo motivo 1.

## Correções em `supabase/functions/sdr-agent/index.ts`

### 1. Expandir `CONFIRMATION_REGEX`

Adicionar variações naturais de assentimento curto em pt-BR:

- `sim`, `pode sim`, `podemos sim`, `pode (fechar|reservar)`, `sim pode`
- `isso`, `isso mesmo`, `é isso`, `é isso mesmo`
- `claro`, `com certeza`, `certeza`
- `vamos`, `bora`, `manda ver`, `topo`, `partiu`
- `ok`, `okay`, `blz`, `valeu`, `👍`, `✅`, `confirma`, `confirmar`

Regex tem que cobrir `sim` isolado mas só quando a mensagem é curta (≤ 6 palavras) para não bater em "não sim né" no meio de uma frase longa. Implementação: além do regex, função `isLikelyConfirmation(text)` que retorna true se:
- regex casa, OU
- a mensagem normalizada tem ≤ 3 palavras E contém uma palavra-chave de assentimento (`sim|ok|blz|isso|claro|certo|👍|✅|bora|topo|valeu`).

Trocar `CONFIRMATION_REGEX.test(inbound)` por `isLikelyConfirmation(inbound)` nos 2 pontos onde é usado.

### 2. Detectar oferta verbal de um único slot

Antes do gate cair em `heldSlots`, tentar reconstruir a "oferta implícita" lendo a última mensagem outbound:

- Pegar o último `outbound` em `ctx.messages`.
- Para cada ISO em `heldSlots` ativos, rodar `matchesSlotReference(lastOutbound, [iso])`.
- Se exatamente UM ISO casar (dia + hora) no texto da última mensagem, tratar como `implicitOffer = [iso]` e usar isso como `candidates` (em vez de toda a lista `heldIsos`).

Assim, "Pode sim" + `implicitOffer = [01/07 09:00]` → `isLikelyConfirmation=true`, candidates tem 1 ISO, gate ok → `slotStart = candidates[0]` → `book_slot` roda.

Também usar `implicitOffer` no segundo ponto que usa `confirmGate` (reschedule, ~linha 1278).

### 3. Mensagem de downgrade quando há oferta implícita

Se `candidates.length === 1` no downgrade, a mensagem deve ser "Só confirmando: posso fechar para X?" (já existe esse ramo via `refIso`) — garantir que `refIso` seja preenchido com `candidates[0]` quando há um único candidato (mesmo sem ref do lead), para evitar relistar.

## Arquivos a alterar

- `supabase/functions/sdr-agent/index.ts` (regex, helper de confirmação, confirmGate em `book_slot` e `reschedule_booking`)

## Fora de escopo

- Nada no `execute-action`, `calcom-*`, UI ou debounce.
- Não mexer no fluxo de `offer_slots` (já corrigido no turno anterior).

## Validação

Após deploy, simular via `curl_edge_functions`:

1. Hold ativo de 01/jul 09:00, última outbound contendo "1º de Julho às 09:00", inbound = "Pode sim 👍🏻" → `liveResult.action="book_slot"` `ok:true`.
2. Inbound = "sim" e há 2 holds sem oferta verbal de um deles → downgrade pede esclarecimento (não agenda sozinho).
3. Inbound = "podemos sim" + oferta verbal de slot único → `book_slot` ok.
