## Objetivo

Substituir a tela atual **Acompanhamento** (`/cadences-dashboard`) por uma visão centrada no lead: tabela enriquecida + drawer lateral com histórico completo. Identificar rapidamente onde cada lead está, qual a última interação e o que vem a seguir.

## Nova tela: Acompanhamento (mesma rota)

### Topo
- Seletor de cadência (mantém o atual).
- KPIs rápidos: total enrolled, ativos, responderam, concluídos, bounced.
- Filtros: status, step atual, canal próximo, intent, busca por nome/empresa/email.
- Botão "Executar agora" (mantém).

### Tabela principal (uma linha por lead)
Colunas:
1. **Lead** — Nome + empresa + cargo (2 linhas, avatar com iniciais).
2. **Step atual** — `Step N / Total` + mini progress bar + ícone do canal do step.
3. **Status** — badge (ativo, respondeu, concluído, bounced, pausado).
4. **Intent** — badge colorido da última intent classificada (ex: interessado, objeção, agendar, sem interesse) — vindo de `lead_intents_log` mais recente.
5. **Última mensagem** — preview de 1 linha (direção + snippet 60 chars + "há X min/h/d"), tooltip com conteúdo completo.
6. **Próxima execução** — data/hora + ícone do canal previsto (do próximo step).
7. **Ações** — botão drawer (chevron) + menu (re-testar, pausar, remover).

Linha inteira clicável → abre drawer.

### Drawer lateral (Sheet à direita, ~520px)
Cabeçalho:
- Nome, empresa, cargo, email, telefone, LinkedIn (links).
- Badges: status, intent atual, step atual.
- Botões: "Abrir conversa", "Re-testar", "Pausar/Retomar", "Simular resposta".

Tabs internas:
- **Timeline da cadência** — lista vertical dos steps (✓ feitos com data/canal, ● atual destacado, ○ futuros com previsão). Cada item expansível mostra o conteúdo enviado (`execution_logs` + `messages`).
- **Conversa** — últimas mensagens inbound/outbound (do `messages` via `conversations`), com badges de canal e simulado.
- **Atividades & Decisões** — `lead_activities` + `cadence_agent_decisions` em ordem cronológica reversa (ações do agente, intents detectadas, motivos).
- **Dados do lead** — campos completos (cargo, segmento, website, score, tags, custom fields).

## O que sai
- Abas atuais "Timeline / Leads / Log de Mensagens" do `CadencesDashboard.tsx` são substituídas pela nova tabela + drawer.
- Timeline da cadência (vista macro de steps) vira um collapsible no topo opcional ("Ver steps da cadência") — não é mais a aba default.

## Detalhes técnicos

Arquivos:
- `src/pages/CadencesDashboard.tsx` — reescrito como tabela + drawer.
- `src/components/cadence/LeadProgressRow.tsx` — linha da tabela.
- `src/components/cadence/LeadProgressDrawer.tsx` — Sheet com tabs.
- `src/components/cadence/LeadTimeline.tsx` — timeline vertical step-by-step.
- `src/hooks/useCadenceLeadProgress.ts` — query única que junta `cadence_enrollments` + `leads` + último `messages` + última `lead_intents_log` + próximo `cadence_steps` + contagem total steps por cadência.

Queries:
- Enrollments por `cadence_id` com joins em `leads(*)`.
- Subqueries/relations: última mensagem (`messages` por `conversation_id` ordenado desc limit 1), última intent (`lead_intents_log` desc limit 1), próximo step (`cadence_steps` por `cadence_id` + `step_order = current_step`).
- Drawer faz queries lazy: `messages`, `lead_activities`, `cadence_agent_decisions`, `execution_logs` por `lead_id`.

UI: shadcn `Table`, `Sheet`, `Tabs`, `Badge`, `Tooltip`, `Avatar`. Tokens semânticos (primary/muted/success/destructive). Sem cores hard-coded.

## Validação
- Selecionar cadência com leads enrolled → tabela mostra todos com step/status/intent/última msg.
- Clicar linha → drawer abre com timeline destacando step atual, conversa com mensagens reais e simuladas, atividades do agente.
- Filtros funcionam (status, intent, busca).
- "Re-testar" reseta enrollment; "Simular resposta" abre o fluxo existente.

## Fora de escopo
- Kanban arrastável, funil, edição de step a partir do drawer, exportação CSV.
