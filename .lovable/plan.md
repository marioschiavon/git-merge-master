# Corrigir o piscar em /leads e /leads/lists

## Diagnóstico

O "piscar" acontece porque as queries do React Query entram em estado `pending` e a tabela renderiza **"Carregando…"** no lugar das linhas, mesmo quando os dados já existiam. Isso ocorre em três cenários hoje:

1. **Filtros recriados a cada render** — em `Leads.tsx`, `useLeads({ status, search })` recebe um objeto novo a cada keystroke/render. Como a `queryKey` muda, a query vai para `isLoading` e a tabela mostra "Carregando…" antes de remontar.
2. **AuthProvider reemite contexto** — `onAuthStateChange` (TOKEN_REFRESHED, visibilidade) chama `setSession`/`fetchUserData` e dispara `setCompanyId` mesmo quando o valor é o mesmo, recriando o objeto de contexto e fazendo as queries reavaliarem.
3. **Sem `placeholderData`** — qualquer refetch (mutação, foco, sidebar invalidando) substitui a lista por "Carregando…" em vez de manter as linhas antigas durante o fetch.

## Mudanças

### `src/pages/Leads.tsx`
- Memorizar o objeto de filtros (`useMemo`) e fazer **debounce** do `search` (~300ms) antes de jogar na query.
- Ajustar mensagem de loading para só aparecer no primeiro carregamento (`isLoading && leads.length === 0`).

### `src/hooks/usePipedrive.ts` — `useLeads`
- Adicionar `placeholderData: (prev) => prev` (keep-previous-data) para manter as linhas durante refetches/troca de filtro.
- Subir `staleTime` para 60s.

### `src/hooks/useLeadLists.ts` — `useLeadLists`
- Mesmo tratamento: `placeholderData: (prev) => prev`, `staleTime: 60_000`.
- Em `LeadLists.tsx`, só mostrar "Carregando…" quando não houver dados anteriores (`isLoading && !lists.length`).

### `src/hooks/useAuth.tsx`
- Evitar `setState` redundante em `setCompanyId`, `setRoles`, `setProfile` quando o valor já é o mesmo (compare antes de setar) para não recriar o contexto e não revalidar todas as queries a cada `TOKEN_REFRESHED`/visibilidade.
- Memorizar o `value` do `AuthContext.Provider` com `useMemo` baseado em `session?.access_token`, `companyId`, `roles.join()`, `profile`, `loading`.

## Detalhes técnicos

- Os hooks usam React Query v5: `placeholderData: keepPreviousData` é a API correta (importar de `@tanstack/react-query`).
- Debounce simples via `useEffect` + `setTimeout`, sem dependência nova.
- Comparação de roles por `JSON.stringify` curto (array pequeno).

## Fora de escopo

- Não vamos adicionar realtime nem mudar a lógica das listas/enrichment; apenas estabilizar o render.
