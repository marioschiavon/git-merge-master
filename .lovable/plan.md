## Diagnóstico

Na run das 21:34, o lead respondeu apenas "Esse é outro Eduardo" — sem repetir o email. O `entity-extractor` só olha o turno atual, então `guests=[]`. Em `policy-engine.ts` (case `add_guests`, linhas 332-336), com booking ativo + lista vazia, o policy força `allowed_tools=["finalize"]` com razão `add_guests_active_booking_missing_emails`. O LLM, vendo o histórico, escreveu "acabo de incluir o outro Eduardo…" — mas a tool `add_guests_to_active_booking` ficou bloqueada. Confirmado: a última `calendar_action` de tipo `add_guests` no booking `f4MAXD8wFyQEyVn9L9CZ7X` foi às 21:27 (do João). Nenhuma chamada para o Eduardo novo. O SDR mentiu.

## Plano

### A) Fallback de emails no policy `add_guests`
`supabase/functions/_shared/policy-engine.ts`, case `add_guests` (linhas 297-350): quando `state.has_active_booking && guestList.length === 0`, varrer as últimas ~4 mensagens inbound de `input.recent_messages` com regex de email. Filtrar contra emails já no convite (`state.active_booking_guest_emails`) e contra o email do próprio lead. Se sobrar email novo → segue `add_guests_with_active_booking` com esse guestList. Só pede clarificação se realmente ficar vazio.

### B) Defesa em profundidade no entity-extractor
`supabase/functions/_shared/entity-extractor.ts`: quando turno atual tem 0 emails mas o intent é `add_guests` e existem emails nas últimas mensagens inbound, herdar essa lista para `entities.guest_emails` aplicando o mesmo filtro.

### C) Guard anti-alucinação no sdr-agent
`supabase/functions/sdr-agent/index.ts`, no safety-net (linhas ~2005-2020): se a mensagem outbound contém verbos de inclusão ("incluí", "adicionei", "acabei de incluir", "foi incluído") E o intent foi `add_guests` E não houve `post_action add_guests_to_active_booking` bem-sucedido neste turno → sobrescrever por mensagem honesta pedindo o email novamente. Evita mentiras mesmo se a extração falhar.

### D) Recuperação manual
Após o deploy:
1. `POST /calcom-add-guests` com `booking_uid=f4MAXD8wFyQEyVn9L9CZ7X` e `guests=["eduardo@julianocarneiro.com.br"]`.
2. `POST /execute-action` → `send_reply` confirmando para a Carolina que ambos os Eduardos estão no convite.

## Arquivos
- `supabase/functions/_shared/policy-engine.ts`
- `supabase/functions/_shared/entity-extractor.ts`
- `supabase/functions/sdr-agent/index.ts`
- Deploy: `sdr-agent`. Curl: `calcom-add-guests` + `execute-action`.
