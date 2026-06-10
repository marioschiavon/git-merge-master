## Problema
Na conversa do Kiko, ele disse "Preciso que seja **em 15 dias**" depois de recusar os primeiros horários. O sistema entrou no fluxo `reject_slots`, mas ofereceu novamente horários nos próximos dias (11 e 15 de junho) — ignorando completamente a janela pedida pelo prospect.

## Causa raiz
O `inbound-webhook` extrai dicas de data do texto do prospect (`extractDateRangeFromText`, que já reconhece "em X dias" / "daqui a X dias") e repassa o `start_after` para o `calcom-slots` em **outras** ações (`schedule`, `reschedule`, `check_availability`, etc.). Mas o ramo `reject_slots` (linhas ~847–904 em `supabase/functions/inbound-webhook/index.ts`) **não chama** `extractDateRangeFromText` nem passa `start_after`/`end_before` para a busca de novos slots. Por isso o Cal.com devolve sempre as próximas vagas, sem respeitar "em 15 dias".

## Correção
No ramo `reject_slots` do `inbound-webhook`:

1. Rodar `extractDateRangeFromText(cleanContent)` antes de invocar `calcom-slots`.
2. Se houver `start_after` / `end_before`, incluí-los no `body` enviado para `calcom-slots`, exatamente como os outros ramos já fazem.
3. Manter o resto da lógica (cancelar holds anteriores, montar a resposta) inalterado.

Resultado: quando o prospect rejeitar os horários dizendo "em 15 dias", "semana que vem", "depois do dia 25" etc., os novos slots oferecidos passam a respeitar essa janela.

## Fora do escopo
- Não vou mexer em `classify-intent` nem no prompt da IA — a extração textual já cobre o caso do Kiko.
- Não vou tocar nos outros ramos que já aplicam `rangeHint`.