## Objetivo

Transformar o fluxo "1 a 1" num **pipeline em lote** com tela única de aprovação (1ª mensagem sempre revisada e editável), organização de listas importadas e, em seguida, modo full-auto, templates híbridos e wizard "Lançar campanha".

## Fluxo central

```text
[Importar CSV/Pipedrive]
        ↓ define: nome da lista + cadência + responsável
[Lista de leads criada] (lead_lists)
        ↓
[Enriquecimento em background] (lead_enrichment_jobs)
        ↓ por lead, ao terminar
[Geração automática da 1ª mensagem] (IA)
        ↓
[Fila de aprovação em lote] (Approvals em modo grid)
   - filtros por lista, cadência, canal
   - edição inline, regenerar, aprovar/rejeitar em massa
        ↓
[Disparo em lote com throttle]
```

## Fase 1 — Pipeline em lote (núcleo)

### 1.1 Organização de listas importadas
- Nova tabela `lead_lists` (`id, company_id, name, source: 'csv'|'pipedrive'|'manual', file_name, created_by, notes, lead_count cache`).
- Coluna `lead_list_id` em `leads` (nullable; lead pode pertencer a 1 lista).
- Tela nova `/leads/lists` (ou aba dentro de Leads): cards/tabela com nome, origem, qtd leads, % enriquecidos, % aprovados, % enviados, data.
- No filtro de Leads, adicionar **filtro por lista**.
- Ao clicar numa lista: abre Leads filtrado + ações ("Aprovar todos pendentes desta lista", "Reenriquecer", "Renomear", "Excluir").

### 1.2 Wizard de importação (`LeadImportDialog`)
Passo extra após mapeamento:
- Nome da lista (default: nome do arquivo)
- Cadência (opcional)
- Toggle "Enriquecer automaticamente" (default on se configurado)
- Toggle "Gerar 1ª mensagem após enriquecer" (default on se cadência selecionada)

### 1.3 Orquestração backend
- Função `cadence-batch-enroll` (ou hook em `enrich-lead`): ao terminar enriquecimento de um lead em lista com cadência → gera 1ª mensagem e cria `approval_requests` com `kind='first_message'`.
- Adicionar `batch_id uuid` em `approval_requests` (= `lead_list_id`) para agrupar e permitir "aprovar tudo deste lote".
- Adicionar `first_message_status` em `cadence_enrollments` (`pending_enrichment` | `pending_approval` | `approved` | `sent`).

### 1.4 Tela de Aprovações em lote
Expandir `/approvals`:
- **Modo grid** com checkbox, preview (subject + 1ª linha), filtros (lista, cadência, canal, status enriquecimento).
- Painel lateral com mensagem editável (mantém detail atual; salva em `edited_payload`).
- Ações em lote: aprovar selecionados, rejeitar, regenerar IA.

### 1.5 Throttle no disparo
- Função `approval-execute-batch` recebe array de IDs e processa com intervalo configurável (ex.: 1 email a cada 2s) para respeitar limites do Gmail.

### 1.6 Indicadores
- Badge em Leads: `Enriquecendo` / `Aguardando aprovação` / `Enviado`.
- Card resumo na lista: `12/50 aprovados · 8 enviados · 30 aguardando`.

## Fase 2 — Modo full-auto por cadência
- Adicionar em `cadences` (ou `cadence_policies`) campo `first_message_mode` (`review_all` | `review_first_only` | `full_auto`).
- Quando `full_auto`: pular `approval_requests` para `first_message` e enviar direto após enriquecer (respeitando throttle).
- UI: toggle no editor da cadência com aviso ("usar apenas em listas validadas").

## Fase 3 — Templates híbridos com slots de IA
- Em `script_templates`, suportar marcadores `{{ai:hook_personalizado}}`, `{{ai:referencia_site}}` etc.
- IA preenche só os slots, não a mensagem inteira → mais rápido, mais barato, mais consistente.
- Editor de template detecta slots e mostra preview com dado de um lead exemplo.
- Geração da 1ª mensagem usa esse caminho quando a cadência aponta para um template híbrido.

## Fase 4 — Wizard "Lançar campanha"
Tela `/campaigns/new` para listas já existentes:
1. Selecionar lista (ou filtro de leads)
2. Selecionar cadência
3. Escolher política de aprovação (review_all / review_first_only / full_auto)
4. Preview de 3 mensagens amostrais + custo estimado + tempo total
5. Botão "Lançar" → mesmo pipeline da Fase 1

## Detalhes técnicos

- **Migrations necessárias** (Fase 1):
  - `lead_lists` (id, company_id, name, source, file_name, notes, created_by, timestamps) + GRANTs + RLS por `company_id`.
  - `leads.lead_list_id uuid nullable` + index.
  - `approval_requests.batch_id uuid nullable` + index.
  - `cadence_enrollments.first_message_status text` + check.
- **Edge functions**:
  - Fase 1: `cadence-batch-enroll` (nova), `approval-execute-batch` (nova), `enrich-lead` (hook ao terminar).
  - Fase 2: ajuste em `cadence-batch-enroll` para pular aprovação se `full_auto`.
  - Fase 3: nova `render-hybrid-template` ou ajuste em `preview-cadence-messages`.
- **Frontend**:
  - Fase 1: `LeadImportDialog` (passo extra), `Approvals.tsx` (modo grid + bulk), nova rota `/leads/lists`, `useApprovals` (paginação + bulk).
  - Fase 2: editor de cadência com toggle.
  - Fase 3: editor de template com slots.
  - Fase 4: nova rota `/campaigns/new`.

## Validação (Fase 1)
- Importar CSV de 10 leads com nome de lista "Teste GroomerGenius" + cadência selecionada.
- Lista aparece em `/leads/lists` com `0/10 enriquecidos`.
- Enriquecimento roda → contador sobe.
- 10 aprovações aparecem agrupadas em Approvals (filtro pela lista funciona).
- Selecionar todas → aprovar → 10 emails saem com throttle.
- Lista mostra `10/10 enviados`.

## Ordem de execução sugerida
1. Migrations (lead_lists, colunas extras).
2. Backend: hook enrich → batch enroll → approval em massa.
3. Frontend: import wizard + tela de listas.
4. Frontend: approvals em grid + bulk actions.
5. Throttle batch send.
6. Fases 2, 3, 4 em sequência depois.
