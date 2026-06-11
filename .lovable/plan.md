## Problema

Na lista de cadências, a "Inteligente" aparece como **Tipo: E-mail** porque na criação o `type` do form (default `"email"`) é salvo no banco mesmo quando a cadência é agêntica. Além disso, mesmo quando o lead tem WhatsApp, a IA pode acabar mandando por e-mail se o `primary_channel` da política não refletir isso.

## Mudanças

### 1. Tipo da cadência agêntica = "multi_channel" (e label "Inteligente")
- `src/pages/Cadences.tsx` → `handleCreate`: quando `form.agentic === true`, gravar `type: 'multi_channel'` no insert (em vez de `email`), junto com `mode: 'agentic'` e `status: 'active'`.
- Esconder o seletor de "Tipo" no diálogo quando agêntica (já está) — sem mudança.
- Na coluna **Tipo** da tabela: se `mode === 'agentic'`, renderizar **"Inteligente (IA)"** em vez de `typeLabels[c.type]`. Mantém consistência visual com o badge IA já existente.

### 2. Política default: WhatsApp como canal principal sempre que possível
Já está no `defaultPolicy` (`primary_channel: "whatsapp"`, `allowed_channels: ["whatsapp","email"]`). Sem mudança.

### 3. Edge function `cadence-agent-decide`: preferir WhatsApp quando o lead tem WhatsApp
Hoje a IA escolhe livremente entre canais permitidos. Vamos adicionar uma **regra determinística antes do LLM**:

- Detectar se o lead tem WhatsApp utilizável (`leads.whatsapp` ou `leads.phone` em formato E.164, e Z-API ativo na empresa).
- Se sim **e** `whatsapp` ∈ `allowed_channels` da política → forçar `primary_channel = "whatsapp"` no contexto enviado ao LLM e adicionar instrução no system prompt: *"O lead tem WhatsApp disponível — prefira WhatsApp; só use e-mail como apoio se já tentou WhatsApp sem resposta nas últimas 2 tentativas, ou se o canal WhatsApp falhou."*
- Se o lead **não** tem WhatsApp → usar `email` (ou o próximo canal permitido) como `primary_channel` efetivo na execução, independentemente do que está salvo na política.

Isso mantém a política do usuário como **preferência**, mas a execução respeita o que cada lead realmente tem.

### 4. Pequeno ajuste na UI da Política
Em `AgenticPolicyForm.tsx`, adicionar uma nota curta abaixo do "Canal principal": *"A IA prioriza este canal quando o lead tem o contato disponível. Caso contrário, usa um canal permitido alternativo."* (apenas texto, sem mudança de lógica no form).

## Validação

1. Criar nova cadência inteligente → linha aparece como **Tipo: Inteligente (IA)** (não mais "E-mail").
2. Lead com `whatsapp` preenchido + Z-API ativa → primeira decisão da IA registra `channel: "whatsapp"`.
3. Lead **sem** whatsapp mas com e-mail → IA usa `email` mesmo com política preferindo whatsapp.
4. Cadências antigas (estáticas) continuam mostrando E-mail/WhatsApp/LinkedIn normalmente.

## Fora de escopo

- Migrar cadências agênticas já criadas com `type='email'` (posso fazer um UPDATE simples opcional, se quiser confirmo no build).
- Mudar a lógica de fallback entre canais após falha — fica como evolução futura.
