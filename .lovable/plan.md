## Objetivo

Hoje a prévia gerada no modo inteligente e a mensagem que efetivamente é enviada são **duas chamadas independentes** ao LLM — o texto pode mudar entre uma e outra, e o SDR não tem como editar antes de disparar. Vamos transformar a prévia em um **rascunho editável** que será exatamente o que sai no WhatsApp/Email quando o SDR clicar em "Executar próximo passo".

A boa notícia: o backend já aceita um parâmetro `override_decision` que pula a geração e usa o texto fornecido. Já existe também o fluxo de Aprovações (quando HITL está ligado) com edição inline — vamos espelhar essa UX direto no card do lead, sem obrigar a passar pela fila de Aprovações.

## Mudanças

### 1. Prévia editável no card do lead (`src/components/CadenceDetail.tsx`)

No bloco `AgentNextPreview`:
- Trocar o texto somente-leitura por um `Textarea` editável com o conteúdo da mensagem (e um `Input` para o assunto, quando canal = email).
- Botões existentes:
  - **Regenerar** — descarta edições e busca novo draft da IA.
  - **Restaurar original** (novo) — volta ao último texto vindo da IA, caso o SDR queira desfazer suas edições.
- Indicador visual sutil "Editado" quando o texto diverge do gerado pela IA.
- Persistir o rascunho editado em memória local (`useState` no componente pai do lead) para sobreviver entre colapsar/expandir o painel.

### 2. "Executar próximo passo" usa o rascunho

- Quando existir um rascunho (gerado ou editado), o botão "Executar próximo passo" passa a invocar `cadence-agent-decide` com `override_decision: { action, channel, hook, subject, message, rationale }`, garantindo que **o texto enviado = o texto da prévia**.
- Se o SDR nunca abriu/gerou a prévia, mantém o comportamento atual (decisão fresca da IA).
- Toast de sucesso passa a diferenciar: "Enviado (rascunho da IA)" vs "Enviado (editado pelo SDR)".

### 3. Registro da edição humana

No backend (`supabase/functions/cadence-agent-decide/index.ts`), no branch `override_decision` (linha ~249), aceitar e propagar duas flags opcionais já úteis para auditoria:
- `override_decision.edited_by_human: boolean`
- `override_decision.original_message?: string`

Persistir ambas em `cadence_agent_decisions.metadata` (ou colunas existentes equivalentes) e adicionar à `lead_activities` algo como "✏️ SDR editou o rascunho da IA antes de enviar" quando `edited_by_human === true`.

### 4. Interação com o HITL (fila de Aprovações)

- Se o HITL estiver **ligado** para o escopo `first_message`/`cadence_step`, o clique continua criando uma `approval_request` — mas agora o `payload` enviado já contém o texto **editado** pelo SDR, então a fila de Aprovações mostra o rascunho final como ponto de partida. Comportamento atual da página `Approvals` (editar/aprovar) continua igual.
- Se o HITL estiver **desligado**, o `override_decision` é enviado direto e a mensagem sai no WhatsApp/Email imediatamente com o texto exato da prévia.

## Fora de escopo

- Mudanças na página `/approvals` (já permite editar).
- Mudanças no `execute-action` / `cadence-executor` (cadência automática sem intervenção continua gerando na hora).
- Versionamento de múltiplos rascunhos / histórico de edições além do registro em `lead_activities`.

## Validação

1. Abrir um lead em cadência inteligente, expandir "Prévia da próxima abordagem (IA)".
2. Editar o texto, clicar "Executar próximo passo".
3. Conferir no WhatsApp/Inbox que a mensagem enviada bate **caractere por caractere** com o texto editado.
4. Conferir em `lead_activities` o registro "✏️ SDR editou…".
5. Repetir com HITL ligado e verificar que a `approval_request` criada já vem com o texto editado no `payload.message`.
6. Repetir sem editar (apenas gerar prévia + executar) → mensagem enviada = texto da prévia, sem chamada extra ao LLM.