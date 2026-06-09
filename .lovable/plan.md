## O que aconteceu com Juliano

1. Lead disse "Preciso que seja a semana que vem" → SDR pediu dia/hora.
2. Lead disse "Dia 16 as 9h" (próxima terça).
3. O sistema entrou em `check_availability` com `suggested_datetime = 16/06 09:00`, viu que não estava disponível, e ofereceu alternativas de **10/06 e 12/06** — semana atual, ignorando completamente a janela pedida pelo lead.

Olhando o código (`inbound-webhook/index.ts` linhas 1015-1080 + `calcom-slots`), quando `check_datetime` é informado e não há disponibilidade, `calcom-slots` cai no caminho "alternativas" mas sem nenhum `start_after`, então usa a janela default (`now + 24h → +14d`) e o `pickSpreadSlots` pega o primeiro dia útil disponível — semana atual.

A correção do comportamento "SDR no controle" se traduz, neste fluxo, em: quando o lead propõe um horário (`check_availability`) e ele não está disponível, **as alternativas devem ser ancoradas na preferência do lead**, não em "agora".

## Mudanças

### 1. `inbound-webhook` — passar janela ancorada em `suggested_datetime`
No bloco `case "check_availability"` (linha ~1040), montar `slotsBody` incluindo:
- `start_after`: início do dia do `suggested_datetime` em BRT (00:00).
- `end_before`: `suggested_datetime + 7 dias` (23:59 BRT do dia +7).
- Se `extractDateRangeFromText(cleanContent)` retornar algo mais específico (ex.: "essa semana", "depois do dia 20"), esse range tem prioridade.

Assim, se o lead pediu 16/06 09h e não tem, as alternativas saem entre 16/06 e 23/06 — mesmo "espírito" da semana sugerida.

### 2. `calcom-slots` — respeitar `start_after` mesmo no fluxo `check_datetime`
Hoje, no caminho "indisponível → alternativas" (linhas ~205-256 de `calcom-slots/index.ts`), o `pickSpreadSlots` usa o `slotsData` já buscado com a janela calculada. A janela já considera `start_after`/`end_before` do body, então **basta passar esses campos do webhook** (mudança 1). Só preciso garantir que o `MIN_LEAD_HOURS` não force a janela para fora do `start_after` quando o lead pediu uma data futura: a lógica atual já faz `startDate = max(earliestStart, start_after)`, então OK.

Pequeno ajuste: se a janela ancorada ao lead retornar 0 alternativas (`selectedSlots.length === 0`), expandir automaticamente para `+14 dias` adicionais e tentar de novo, antes de cair no fallback do link Cal.com.

### 3. Mensagem mais clara quando há só 1 alternativa próxima
Hoje, se vier só 1 slot, cai no fallback de link. Preferir mostrar essa 1 opção ancorada à preferência do lead com texto:
> "Não tenho 09h no dia 16, mas tenho **terça-feira, 16 de junho às 14:00**. Funciona?"

(Usa `slotsRes.data.formatted[0]` quando length === 1.)

### Fora de escopo
- Alterar `extractDateTimeFromText` / classificador.
- Mudar a lógica de `schedule` puro (já usa `extractDateRangeFromText`).
- UI/configuração de janela por empresa.

## Arquivos tocados

```text
supabase/functions/inbound-webhook/index.ts
  └── case "check_availability": calcular start_after/end_before a partir
       de parsed.suggested_datetime (ou extractDateRangeFromText) e
       passar em slotsBody. Ajustar fallback de 1 slot.

supabase/functions/calcom-slots/index.ts
  └── No caminho check_datetime → indisponível: se selectedSlots.length===0,
       refazer busca expandindo end_before em +14 dias.
```

Resultado esperado na próxima conversa: lead pede "16/06 09h", indisponível → SDR oferece 2 horários **entre 16 e 23 de junho**, mantendo a iniciativa e respeitando a semana pedida.
