## Contexto observado na conversa

Mensagens reais:
1. SDR pergunta: *"Sem problemas, Juliano... devo cancelar o nosso agendamento de terça e procurar o Carlos Vilagran?"*
2. Lead: *"Isso mesmo. email dele é nutrisapiens.butanta@gmail.com. Pode falar que eu indiquei."*
3. SDR responde: *"Combinado, Juliano... **Vou cancelar nosso horário** e entrar em contato diretamente com ele."*

Resultado no banco:
- O booking continua **confirmado** no Cal.com — o agente prometeu cancelar mas não chamou a tool `cancel_booking`.
- Novo lead criado com `name = "Nutrisapiens Butanta"` (derivado do email) em vez de `Carlos Vilagran`, mesmo o Juliano tendo dito antes *"Quem cuida disso não sou eu é o Carlos Vilagran."*

## Causas

**Bug 1 — cancelamento não executado**
Em `sdr-agent/index.ts` o prompt cobre "se o lead PEDE cancelar". Aqui foi o SDR que propôs cancelar e o lead confirmou ("Isso mesmo"). O modelo tratou só como `send_message` e esqueceu a tool. Falta uma regra dura: quando há booking ativo + na turn anterior o SDR perguntou se cancela + lead confirma → obrigatório `cancel_booking` antes do `send_message`. Também falta uma rede de segurança no executor que detecte intenção de cancelamento no próprio texto que o agente vai enviar (verbos "vou cancelar", "cancelei", "vou desmarcar") e force a chamada da tool se ainda não foi feita.

**Bug 2 — nome do lead errado**
Em `_shared/entity-extractor.ts` os `NAME_HINT_PATTERNS` não cobrem a forma "**é o/a X**" que aparece após um sinal de redirecionamento (ex.: "não sou eu, é o Carlos Vilagran" / "quem cuida disso é a Andreia"). Como o nome não foi extraído na turn anterior, o `referral_pending_name` ficou vazio; quando o email chegou na turn seguinte, `create_new_contact` caiu no fallback de derivar o nome do local-part do email.

## Mudanças

### 1. `supabase/functions/_shared/entity-extractor.ts`
Adicionar padrões PT-BR ao `NAME_HINT_PATTERNS` (na ordem certa — mais específicos primeiro):
- `quem (cuida|vê|trata|cuidaria) (disso|desse assunto) (é|seria) (o|a) X`
- `(não sou eu|não é comigo)[,.\s]+ é (o|a) X`
- `é (o|a) X` (genérico, só aplicado se `REDIRECT_SIGNAL_RE` também casar no texto, para evitar falsos positivos)
- `quem (faz|cuida de) isso é (o|a) X`

Atualizar `entity-extractor_test.ts` com os textos reais:
- "Quem cuida disso nao sou eu é o Carlos Vilagran." → name = "Carlos Vilagran"
- "quem cuida disso é a Andreia" → name = "Andreia"

### 2. `supabase/functions/sdr-agent/index.ts`
- **Prompt**: adicionar regra explícita — se o turn anterior do SDR perguntou "devo cancelar?" / "posso cancelar?" e o lead respondeu afirmativamente (isso/sim/pode/combinado/ok), é OBRIGATÓRIO chamar `cancel_booking` ANTES do `send_message`. Mesma regra quando a própria mensagem que o SDR vai enviar contém "vou cancelar/cancelei/vou desmarcar/desmarquei".
- **Hint contextual**: quando há booking ativo e o último outbound contém pergunta de cancelamento, injetar `⚠️ AÇÃO OBRIGATÓRIA: chamar cancel_booking antes de responder` no bloco de contexto.
- **Guard de finalize**: antes de aceitar `decision=send_message`, se o `message` contém regex de promessa de cancelamento (`/\b(vou\s+cancelar|cancelei|vou\s+desmarcar|desmarquei|cancelar\s+(nosso|o)\s+(hor[áa]rio|agendamento|reuni[ãa]o))/i`) e existe booking ativo e nenhum `cancel_booking` foi chamado nessa run, recusar/forçar nova iteração (logar e devolver para o loop). Se o loop esgotar, executar `calcom-booking-cancel` programaticamente antes de enviar a mensagem.

### 3. Backfill do estado atual
- Cancelar no Cal.com o booking ativo do `Juliano` (lead `80c6732c-…`) já que ele foi prometido.
- Atualizar o lead `9228bbab-…` para `name = 'Carlos Vilagran'` (manter referrer_name = 'Juliano').

### 4. Deploy
Deploy de `sdr-agent`. (`entity-extractor` é compartilhado e vai junto.)

## Validação
- Rodar `entity-extractor_test.ts` cobrindo os novos casos.
- Testar via `curl_edge_functions` simulando o turn "Isso mesmo. email dele é ...@gmail.com" com booking ativo e turn anterior perguntando cancelamento → esperar `cancel_booking` chamado + lead criado com nome correto.
