# Verificação de grupos + HITL global

## 1. Grupos no WhatsApp — verificação

Já verifiquei no código e no banco:

**Entrada (inbound):** `supabase/functions/hook7-webhook/index.ts` já ignora explicitamente qualquer mensagem cujo `Chat` termine em `@g.us`, `@broadcast` ou `@newsletter`, ou tenha `IsGroup=true`. Nenhum lead/conversation é criado a partir de grupo.

**Saída (outbound):** Os disparos usam sempre o telefone do lead (`leads.phone` / `leads.whatsapp`), que é normalizado para `+55...` na importação. Não existe caminho no código que envie para JID de grupo.

**Confirmação no banco:**
- Nenhuma `conversation` com telefone contendo `@g.us` ou `broadcast`.
- Todas as mensagens `hook7` gravadas têm `IsGroup=false` (100% 1:1, `s.whatsapp.net` ou `lid`).

**Conclusão:** conversas para grupos **não estão sendo enviadas nem recebidas**. Sistema OK.

## 2. Ativar HITL em todas as empresas

Hoje só a empresa **Hook7** está com `hitl_enabled=true`. As outras 3 (Leaderei, leadereitestehenrique, S7) estão com HITL desligado.

Vou rodar um UPDATE ligando `hitl_enabled=true` em todas as empresas, mantendo os `hitl_scopes` já configurados (todos os 4 escopos: `first_message`, `sdr_reply`, `cadence_step`, `sensitive_action` já estão `true` em todas).

```sql
UPDATE public.companies SET hitl_enabled = true WHERE hitl_enabled = false;
```

Efeito: toda mensagem gerada pela IA (primeira mensagem, resposta SDR, passo de cadência, ação sensível) passa a exigir aprovação humana antes de sair, em todas as empresas.

## Detalhes técnicos

- Apenas 1 statement de dados (`supabase--insert`), sem alteração de schema.
- Nenhum código alterado — o gate HITL (`_shared/hitl-gate.ts`) já lê `companies.hitl_enabled` em tempo real.
