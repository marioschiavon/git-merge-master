## O que aconteceu com Juliano

Histórico real da conversa:
1. Sistema confirmou reunião **16/06 às 17:45**.
2. Lead respondeu: **"Preciso alterar para dia 17 as 9h."**
3. IA classificou como `check_availability` com `suggested_datetime = 17/06 09:00` (reasoning dela: "devemos checar disponibilidade").
4. Mas como já existe um `slot_holds.status='confirmed'`, o **guard anti-double-booking** (linha 671-686 de `inbound-webhook/index.ts`) sobrescreve a ação para `reply` e força a mensagem fixa: *"Já temos uma reunião confirmada para terça-feira, 16 de junho às 17:45! Caso precise reagendar, é só me avisar."*

Ou seja: o lead já estava pedindo para reagendar, mas o guard ignora isso e responde como se ele estivesse tentando marcar uma nova reunião do zero.

Causas:
- O prompt da IA **não recebe** nenhum contexto sobre reunião confirmada existente, então ela escolhe `check_availability` em vez de `reschedule`.
- O guard trata qualquer `check_availability` com booking confirmado como tentativa de double-booking, sem considerar que o lead está claramente propondo um novo horário (intenção de reagendar).

## Mudanças

### 1. `supabase/functions/inbound-webhook/index.ts` — injetar contexto de booking confirmado no prompt

Antes de montar o `systemPrompt`, buscar `slot_holds` confirmado do lead (já é feito mais abaixo no guard — adiantar a consulta). Se existir, anexar bloco curto ao prompt:

```
REUNIÃO ATUALMENTE CONFIRMADA: <data/hora BRT formatada>
→ Se o prospect pedir para trocar/alterar/mover/remarcar esse horário (com ou sem nova data sugerida), use action = "reschedule" e preencha "suggested_datetime" se ele indicou um novo horário.
→ NÃO use "check_availability" quando já existe reunião confirmada — use "reschedule".
```

### 2. Ajustar o guard anti-double-booking (linhas 671-686)

Em vez de sempre converter para `reply`, distinguir intenção:

- Se `parsed.action === "check_availability"` E há booking confirmado E `parsed.suggested_datetime` existe → **converter para `reschedule`** (mantendo `suggested_datetime`). Deixar o branch `reschedule` (linhas 788-928) executar o cancelamento + nova oferta normalmente.
- Se `parsed.action === "schedule"` E há booking confirmado → manter comportamento atual (responder lembrando da reunião). Essa é a única situação ambígua de double-booking real.
- `confirm_slot` com booking confirmado → manter o reply atual.

### 3. Fora de escopo
- Mudanças no classificador/`ai-reply`.
- Lógica de `calcom-slots` ou janela de tempo.
- UI.

## Arquivos tocados

```text
supabase/functions/inbound-webhook/index.ts
  ├── Adiantar consulta de slot confirmado para antes do prompt
  ├── Anexar bloco "REUNIÃO ATUALMENTE CONFIRMADA" ao systemPrompt quando aplicável
  └── Refinar guard: check_availability + booking confirmado + suggested_datetime → reschedule
```

## Resultado esperado

Lead com reunião 16/06 17:45 manda "Preciso alterar para dia 17 as 9h":
→ IA escolhe `reschedule` com `suggested_datetime=17/06 09:00`.
→ Sistema cancela a reunião do dia 16 no Cal.com, verifica 17/06 09:00, reserva e confirma (ou oferece alternativas próximas se indisponível).
→ Mensagem ao lead reflete a troca real, não o lembrete da reunião antiga.
