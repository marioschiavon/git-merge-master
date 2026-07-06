## Objetivo
Validar ponta a ponta a integração Apollo no preview autenticado: conexão da API key, busca de prospects e importação em lote com deduplicação.

## Passos (Playwright headless, viewport 1280×1800)

1. **Bootstrap de sessão**
   - Restaurar cookies + `localStorage` do Supabase (sessão do preview já injetada).
   - Navegar para `/settings/integrations`. Screenshot.

2. **Conectar Apollo**
   - Abrir o card "Apollo.io" → dialog `ApolloConnectDialog`.
   - Colar a API key (lida de `os.environ["APOLLO_TEST_KEY"]`) e clicar em "Conectar".
   - Confirmar toast "Apollo conectado!" + badge "Validado …". Screenshot.
   - `curl` na edge function `apollo-status` esperando `connected: true`.

3. **Buscar prospects**
   - Ir para `/apollo`.
   - Preencher filtros mínimos (cargo "CEO", senioridade "c_suite", país "Brazil").
   - Executar busca; validar resultados renderizados. Screenshot.
   - Conferir network: `apollo-search` retorna 200 com `people` + `existingEmails`/`existingApolloIds`.

4. **Importar leads**
   - Selecionar 2 resultados → "Importar selecionados".
   - Esperar toast "Importação concluída · X criados · Y atualizados · Z pulados". Screenshot.
   - `supabase--read_query` em `leads` filtrando pelos `apollo_person_id` para confirmar persistência.

5. **Reimportar (dedup)**
   - Repetir importação → esperar `updated=2, created=0`. Screenshot.

6. **Cleanup**
   - Voltar em Integrações → "Desconectar Apollo". Confirmar `apollo-status` = `connected: false`.

## Critérios de sucesso
- Todos os toasts esperados sem erros de console.
- `apollo-status`, `apollo-search`, `apollo-import` retornam 200.
- Leads gravados em `public.leads` com `apollo_person_id` e `company_id` corretos.
- Segunda importação faz update (prova dedup).

## Notas técnicas
- Script em `/tmp/browser/apollo-e2e/test.py`; screenshots em `/tmp/browser/apollo-e2e/screenshots/`.
- API key passada apenas como variável de ambiente no comando; não persiste em arquivos versionados nem é logada.
- Sem alterações no código do projeto.

## Fora de escopo
- Testes de rate limit, cache 24h e cron de re-enriquecimento.
