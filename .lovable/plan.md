# Sobrescrever e-mail do lead via mensagens + evitar perguntar quando já existe

## Diagnóstico

Caso Nico:
- Lead já tinha `email = nico@leaderei.com.br` no banco.
- SDR perguntou "qual o melhor e-mail?" (mensagem gerada pela IA).
- Lead respondeu `nico@leaderei.com` (sem `.br`).
- Banco **continuou** com `nico@leaderei.com.br` — a atualização não rolou porque o único trecho de update do email é `if (providedEmail && !leadData?.email)` (linha 1141 do `inbound-webhook`), só captura quando o lead **não tinha** e-mail. Também há outro update em linha 292, gated por `if (!leadData.email)`. 

Duas falhas combinadas:
1. **Captura passiva**: e-mail vindo do lead nunca sobrescreve um existente — então correções (`nico@…br` → `nico@…com`) são ignoradas.
2. **Geração de mensagem**: o prompt principal (`inbound-webhook` linhas 727-740) só manda `Lead: <nome> (<empresa>)` — a IA **não sabe** que já existe e-mail cadastrado, então pede "qual o melhor".

## Correções

### 1. Sempre atualizar `leads.email` quando o lead envia um e-mail próprio na conversa

Onde: novo bloco logo após classificar intent no `inbound-webhook` (antes do redirect/guards), e remover o gate `&& !leadData?.email` dos dois pontos atuais.

Regra de captura:
- Extrair com regex `/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i` na `cleanContent`.
- Aceitar como "e-mail do próprio lead" quando **uma** das condições for verdade:
  - `intent.category === 'channel_switch'` e `sub_intent === 'send_by_email'`
  - `parsed.provided_email` (campo já existente no JSON do prompt) bate com o regex
  - Mensagem tem **apenas o e-mail** (≤80 chars, 1 endereço, sem nome próprio antes)
- **Excluir** quando `intent.category === 'routing'` ou `sub_intent === 'referral'` (esse caso é tratado em `referred_email`, não muda o do lead) — e quando o e-mail extraído **bate** com `entities.referred_email`.
- Comparação case-insensitive; só faz `UPDATE leads SET email = … WHERE id = …` se for **diferente** do atual.
- Logar em `lead_activities` tipo `note`:  
  `✉️ E-mail do lead atualizado: <antigo> → <novo>`

Implicação: se o lead errar e mandar `nico@leaderei.com`, vira email novo; se depois mandar `nico@leaderei.com.br` corrigindo, troca de novo.

### 2. Injetar o e-mail atual no prompt da IA

Onde: `inbound-webhook` linhas 727-740 (e equivalente em `cadence-agent-decide` se gerar respostas a inbound também).

Mudança no `content` da role user:
```
Lead: <nome> (<empresa>)
E-mail cadastrado: <email ou "nenhum">
WhatsApp cadastrado: <whatsapp ou "nenhum">
```

E uma regra explícita no `systemPrompt`:
> Se o prospect pedir contato por e-mail/material/resumo e já houver "E-mail cadastrado", **não pergunte "qual o melhor e-mail"**. Apenas confirme curto: *"Posso te enviar para `<email>`?"*. Só pergunte um novo se ele recusar/disser que prefere outro.

### 3. Endurecer a confirmação ("é esse mesmo?") como caminho padrão

Adicionar no mesmo bloco do passo 1: quando o intent é `channel_switch / send_by_email` **e o lead não mandou e-mail novo** **e** já existe email cadastrado:
- Substituir o `parsed.reply_message` (quando AI ainda fez a pergunta indevida) por:  
  *"Combinado! Posso te enviar para `<email cadastrado>`?"*  
  Detecção: AI gerou texto cuja regex bate `/(qual|me\s+pass|me\s+envia|melhor)\s+(o|seu)?\s*e-?mail/i` mas lead já tem email. Fallback de segurança, caso a regra do prompt no passo 2 não pegue.

### 4. Backfill imediato do Nico (opcional, manual)

Atualizar `leads.email` do Nico (`35169ba4...`) de `nico@leaderei.com.br` para `nico@leaderei.com` (o último valor que ele forneceu) — confirma com usuário antes de rodar.

## Arquivos tocados

- `supabase/functions/inbound-webhook/index.ts` — bloco de captura/sobrescrita de e-mail; injeção de contexto no prompt; fallback de reply quando AI pede email já existente; remover gate `!leadData?.email` nos dois pontos de update.
- `supabase/functions/cadence-agent-decide/index.ts` — mesma injeção de "E-mail cadastrado" no contexto do prompt (verificar se ele gera reply para inbound).

## Validação

1. Inbound `"meu email é teste@x.com"` em lead **sem email** → `leads.email = teste@x.com`, activity log.
2. Inbound `"na verdade é teste@y.com"` no mesmo lead → `leads.email = teste@y.com`, activity log de troca.
3. Inbound `"me envia um material"` com lead que **já tem email** → resposta da IA confirma o e-mail existente, não pergunta novo.
4. Inbound `"indica meu colega: ana@empresa.com"` (`routing`/`referral`) → e-mail do lead **não** é alterado; cai no fluxo de criar contato indicado.
