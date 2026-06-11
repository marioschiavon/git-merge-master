# Remover duração fixa do objetivo e só citar tempo se o lead perguntar

## Problema
Hoje o SDR (IA) abre conversa mencionando "reunião de 15 minutos" — tempo hard-coded em `src/components/AgenticPolicyForm.tsx` e propagado para os prompts. Queremos que o SDR fale de forma natural ("uma conversa rápida de apresentação") e só revele a duração real quando o lead perguntar.

## Solução

### 1. Texto do objetivo padrão
- **`src/components/AgenticPolicyForm.tsx`**: trocar `defaultPolicy.goal` de `"Agendar reunião de 15 minutos"` para algo como `"Agendar uma conversa rápida de apresentação"`. Sem número de minutos.
- Não sobrescrever políticas já salvas; só afeta novas.

### 2. Prompt do agente / primeira mensagem
- **`supabase/functions/_shared/build-first-message.ts`** e **`supabase/functions/cadence-agent-decide/index.ts`** (e qualquer outro lugar onde o `goal` ou duração da reunião entra no prompt — confirmar via busca por `length_minutes`, `minutos`, `duration`):
  - Adicionar instrução explícita no system prompt:
    > "Nunca mencione a duração exata da reunião nas mensagens proativas. Refira-se como 'uma conversa rápida de apresentação' / 'um papo curto'. Só informe a duração ({N} minutos do Cal.com) se o lead perguntar diretamente quanto tempo vai durar."
  - Passar a duração real do event type padrão do Cal.com como contexto (`meeting_duration_minutes`) buscando em `calcom_event_types` via `companies.calcom_default_event_type_id`. Esse valor fica disponível para a IA usar apenas quando o lead perguntar.

### 3. Onde buscar a duração no backend
- Em `cadence-agent-decide` e `generate-reply` (e `ai-reply` se aplicável): após carregar `company`, fazer `select length_minutes from calcom_event_types where company_id = ... and calcom_id = company.calcom_default_event_type_id` e injetar no prompt como variável de contexto.
- Fallback: se não houver event type, omitir a variável e instruir a IA a responder algo genérico como "rapidinho, cerca de 30 minutos no máximo" — ou melhor, "vou confirmar a duração com você".

## Escopo
- Texto padrão do formulário (frontend).
- System prompt das funções que geram mensagens (backend edge functions).
- Sem mudança de schema, sem mudança em UI de Cal.com Settings.

## Fora de escopo
- Editar políticas já salvas com `goal` antigo (usuário pode atualizar manualmente).
- UI para sincronizar/visualizar a duração na tela de política.
