# Corrigir "Failed to send a request to the Edge Function" ao conectar Cal.com

## Diagnóstico

As três edge functions novas criadas na implementação multi-tenant (`calcom-connect`, `calcom-test-connection`, `calcom-disconnect`) existem no repositório mas **nunca foram invocadas** — os logs estão vazios ("No logs found"). Isso indica que ainda não subiram para o runtime da Lovable Cloud, então o cliente recebe erro de rede genérico (`Failed to send a request to the Edge Function`) porque a URL retorna 404 no edge.

## Ação

1. Forçar deploy imediato das três functions via `supabase--deploy_edge_functions`:
   - `calcom-connect`
   - `calcom-test-connection`
   - `calcom-disconnect`
2. Após o deploy, testar `calcom-test-connection` com uma chave inválida via `supabase--curl_edge_functions` para confirmar que a function responde (esperado: 400 com mensagem "Cal.com rejeitou a API key").
3. Se der erro de boot, ler `supabase--edge_function_logs` e ajustar o código (import quebrado, secret faltando, etc.).

## Fora do escopo

Nenhuma mudança de código, banco, RLS, UI ou documentação — só deploy + smoke test das functions já escritas.
