# Prévia da próxima abordagem no modo Inteligente

## Problema

No modo Inteligente, a mensagem não vem de um template fixo — ela é gerada na hora pelo agente (`cadence-agent-decide`) com base no contexto do lead, histórico e política. Por isso o card só mostra "Executar próximo passo" às cegas: você só vê o conteúdo depois que ele é enviado/registrado.

Diferente do modo clássico (que tem `CadenceFirstMessageInline` + `preview-cadence-messages`), aqui não existe um endpoint de preview para o agente.

## Solução

Adicionar um modo **dry-run** ao decisor agêntico e expor uma prévia inline por lead, ao lado de "Executar próximo passo".

### 1. Backend — `supabase/functions/cadence-agent-decide/index.ts`

Aceitar `dry_run: true` no body. Quando ligado:
- Executa toda a lógica de decisão (LLM, política, business hours, hooks, `buildFirstMessage` para 1ª abordagem).
- **Pula** todos os efeitos colaterais: não envia WhatsApp/email, não insere em `cadence_agent_decisions`, não cria/atualiza `messages`, não atualiza `cadence_enrollments` (next_execution_at, attempt_number), não enfileira ações, não dispara HITL.
- Retorna `{ decision: { action, channel, hook, subject, message, rationale, scheduled_for } }`.

Implementação: um guard `if (dryRun) return jsonResponse({ decision })` logo após a decisão estar montada e antes do primeiro write.

### 2. Hook — `src/hooks/useAgenticCadence.ts` (ou novo `useAgentPreview.ts`)

```ts
useAgentNextPreview(enrollmentId)  // useQuery, staleTime 5min
useRegenerateAgentPreview()         // useMutation, invalida o query
```

Chama `supabase.functions.invoke("cadence-agent-decide", { body: { enrollment_id, dry_run: true } })`.

### 3. UI — `src/components/CadenceDetail.tsx` (bloco `AgenticSimulationControls` / card do lead)

Acima do botão "Executar próximo passo", inserir um bloco compacto inspirado em `CadenceFirstMessageInline`:

- Badge do canal (whatsapp/email) + hook + "Prévia IA".
- Linha de assunto (se email).
- Corpo truncado em 180 chars com "Ver completa".
- Botões: 🔄 Regenerar prévia, ✏️ (futuramente editar — fora de escopo).
- Se `action !== "send"` (ex: wait/stop/handoff): mostrar o motivo (`rationale` / `stop_reason`) em vez de mensagem.
- Loading skeleton enquanto busca; erro com "Tentar novamente".

O botão "Executar próximo passo" continua chamando o decisor normal — a prévia é só visualização. Após executar, invalidar o query da prévia.

### 4. Validação

- Abrir cadência Inteligente, aba Leads, ver prévia carregando automaticamente para cada lead ativo.
- Confirmar via `cadence_agent_decisions` que nenhuma linha nova foi criada ao abrir prévia.
- Clicar Regenerar → nova mensagem aparece, ainda sem registros novos.
- Clicar Executar próximo passo → mensagem real é enviada (pode diferir da prévia, já que o LLM não é determinístico — deixar nota visível "Prévia estimada; a mensagem final pode variar").

## Fora de escopo

- Editar e travar a prévia para garantir envio idêntico (precisaria persistir e bypassar o LLM no envio).
- Mudanças no modo clássico.
- Custos: cada prévia consome uma chamada de LLM; carregar sob demanda (expand) se quiser economizar — confirme se prefere auto-load ou on-demand.

## Pergunta antes de implementar

Prefere a prévia **auto-carregada** ao abrir a aba Leads (mais cômodo, gasta 1 chamada LLM por lead listado) ou **on-demand** via botão "Ver prévia" (economiza créditos)?
