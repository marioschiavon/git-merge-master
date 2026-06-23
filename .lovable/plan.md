## Por que as telas piscam

O `QueryClient` em `src/App.tsx` é criado sem opções, então valem os defaults do React Query:

- `refetchOnWindowFocus: true` → toda vez que você volta para a aba/janela, todas as queries são refetchadas.
- `refetchOnMount: true` + `staleTime: 0` → cada navegação entre páginas refaz as queries do zero.
- `refetchOnReconnect: true` → qualquer oscilação de rede dispara refetch.

Somado a isso, vários hooks fazem `refetchInterval` (Approvals 30s, SlotHolds 30s, HumanInbox 30s, LeadBooking 30s) e há canais realtime do Supabase em Conversations/Messages que chamam `invalidateQueries` agressivamente (inclusive `["conversations", companyId]` e `["lead-messages"]` em cada evento).

O "piscar" acontece porque as páginas (`Leads`, `Dashboard`, `Conversations`, etc.) trocam o conteúdo por skeleton/spinner enquanto `isLoading`/`isFetching` está true — e com `staleTime: 0` isso vira loading toda hora.

## Plano

1. **Configurar defaults sãos no `QueryClient`** (`src/App.tsx`):
   - `staleTime: 30_000` (30s) para evitar refetch imediato a cada mount.
   - `gcTime: 5 * 60_000`.
   - `refetchOnWindowFocus: false`.
   - `refetchOnReconnect: false`.
   - `retry: 1`.

2. **Evitar flash de skeleton em refetch em background**: nas páginas que mostram listas grandes (`Leads`, `Conversations`, `CadencesDashboard`, `Approvals`, `Inbox`), trocar a condição de skeleton de `isLoading` para algo que só dispare na primeira carga — por padrão `useQuery` já só deixa `isLoading=true` quando não há dados em cache, mas vou revisar páginas que usam `isFetching` ou que recriam estado a cada render.

3. **Reduzir invalidations duplicadas do realtime em `Conversations.tsx`**: hoje cada evento de `messages` invalida `["conversations", companyId]`, `["messages", convId]` e `["lead-messages"]`. Vou manter apenas o que muda visualmente (mensagens da conversa atual) e debouncar a invalidation de `conversations` (ex.: só invalidar se o evento for de uma conversa não-aberta, ou usar `setQueryData` para atualizar localmente).

4. **Revisar `refetchInterval` agressivos**: subir de 30s para 60s onde não for crítico (SlotHolds, LeadBooking) — Approvals e Inbox podem ficar em 30s. Opcional, posso deixar como está se preferir.

5. **Validar no preview**: navegar entre Leads → Conversations → Dashboard, alternar de aba e confirmar que não há mais flash de skeleton.

### Detalhes técnicos

- Item 1 é a mudança que mata 90% do piscar (focus refetch é o mais comum).
- Item 2/3 cobrem os casos onde realtime dispara renderização cheia.
- Nada do backend / edge functions muda.
