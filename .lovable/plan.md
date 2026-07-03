## Objetivo
Verificar se a Base de Conhecimento (/knowledge) está 100% funcional: adicionar texto, upload de documento, extração de URL, edição, exclusão, destaques, instruções da IA e geração de embeddings para uso pela IA nas cadências.

## Achados da auditoria (antes de rodar teste)

1. **BUG crítico em `embed-knowledge`** — usa import inválido `npm:@supabase/supabase-js@2/cors`. Esse subpath não existe, então a função quebra ao ser chamada (deploy/execução falham). Precisa ser trocado por `corsHeaders` local (padrão usado nas outras functions do projeto).

2. **Embeddings nunca são gerados automaticamente** — o trigger `trg_mark_knowledge_needs_embedding` marca `needs_embedding=true` ao inserir/alterar `company_knowledge`, mas:
   - Nenhuma parte do frontend (`useKnowledge.ts`, `Knowledge.tsx`) chama `embed-knowledge` após criar/editar.
   - `embed-knowledge` também não atualiza `needs_embedding=false` nem `embedded_at` após processar.
   - Resultado: `knowledge_chunks` fica vazia (confirmado no DB — 0 linhas), e a IA (cadence-agent-decide, sdr-agent, etc.) não consegue recuperar contexto via `match_knowledge_chunks`.

3. **Sem cron/processador** para varrer itens com `needs_embedding=true`.

## Plano de execução

### Etapa 1 — Corrigir bugs
- `supabase/functions/embed-knowledge/index.ts`: substituir o import quebrado por `corsHeaders` inline (mesmo padrão de `extract-knowledge` e `parse-knowledge-doc`). Ao final do `embedDocument`, executar `UPDATE company_knowledge SET needs_embedding=false, embedded_at=now() WHERE id=doc.id`.

### Etapa 2 — Disparar embedding automaticamente
- Em `useKnowledge.ts`, após `useCreateKnowledge` e `useUpdateKnowledge` completarem com sucesso, chamar (fire-and-forget) `supabase.functions.invoke("embed-knowledge", { body: { knowledge_id } })`. Falha na indexação não deve quebrar a UI (só log).
- Também disparar após `useSaveHighlights` e `useSaveAiInstructions` para que esses conteúdos entrem no retrieval.

### Etapa 3 — Testar E2E via Playwright na preview
Com a sessão do usuário atual injetada, rodar um script que:
1. Faz login na sessão e navega para `/knowledge`.
2. Adiciona um item de texto ("Teste QA – Proposta de Valor" + conteúdo curto), verifica toast + card renderizado.
3. Salva "Destaques para Prospecção" e "Instruções da IA", verifica toasts.
4. Extrai uma URL simples (ex: site institucional público) e valida que card foi criado.
5. Edita o item de texto criado e salva.
6. Exclui o item de texto.
7. Consulta `company_knowledge` e `knowledge_chunks` via `psql` para confirmar linhas persistidas e chunks embutidos.
8. Captura screenshots de cada passo.

### Etapa 4 — Relatório final
Resumo do que passou / falhou, com screenshots-chave e contagem de chunks gerados. Se o upload de documento (PDF) exigir arquivo do usuário, marco como "não testado — requer arquivo" em vez de inventar um.

## Fora de escopo
- Reescrever o pipeline de RAG.
- Criar cron de re-embedding em massa (posso propor depois se quiser).
- Alterar telas fora de `/knowledge`.

## Detalhes técnicos
- Arquivos alterados: `supabase/functions/embed-knowledge/index.ts`, `src/hooks/useKnowledge.ts`.
- Novo comportamento: após qualquer create/update de conhecimento, invocação assíncrona de `embed-knowledge` popula `knowledge_chunks` e marca `embedded_at`.
- Sem migrações; sem mudanças de RLS; sem mudanças de tipos gerados.
