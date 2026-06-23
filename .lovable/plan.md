## Próximas fases do Batch Pipeline

Implementar as Fases 2, 3 e 4 do plano, mais o fechamento da Fase 1 (ativar de verdade o campo "Cadência" do import).

---

### Fase 1.5 — Fechar o loop import → cadência → aprovação

Hoje o `lead_lists.default_cadence_id` é só metadado. Conectar:

- Quando a enrichment de um lead termina (`lead_enrichment_jobs` → `done`) e o lead tem `lead_list_id` com `default_cadence_id`:
  1. Criar `cadence_enrollment` automaticamente (status `active`, `first_message_status = 'generating'`).
  2. Disparar geração da 1ª mensagem via AI (edge function `generate-first-message`, reaproveitando prompts existentes do agent).
  3. Criar `approval_request` com `batch_id = lead_list_id`, `first_message_status = 'pending_approval'`.
- Contadores em `lead_lists` (`pending_approvals`, `enriched_count`) atualizados via trigger.
- UI de `LeadLists` mostra barra de progresso real: importados → enriquecidos → aprovados → enviados.

---

### Fase 2 — Modo Full-Auto (toggle por cadência)

- Migração: `cadences.auto_approve_first_message boolean default false` + `cadences.auto_approve_max_per_day int default 50` (guard-rail).
- UI: na tela de edição de cadência, seção "Automação" com:
  - Toggle "Aprovar e enviar 1ª mensagem automaticamente"
  - Aviso visual ("⚠ Mensagens vão direto pro lead sem revisão humana")
  - Limite diário (slider)
- Backend: em `hitl-gate.ts`, se a cadência da enrollment tem `auto_approve_first_message = true` e o contador diário ainda permite, marca `approval_request.status = 'auto_approved'` e enfileira envio direto.
- Log em `cadence_agent_decisions` com `decision_type = 'auto_approved'` para auditoria.
- Filtro extra em `Approvals`: "Mostrar auto-aprovadas" (off por default).

---

### Fase 3 — Templates híbridos com slots de IA

Mensagem como `script_template.body` com sintaxe:

```text
Oi {{lead.first_name}}, vi que vocês {{ai:hook sobre o site}}.
Faz sentido conversar sobre {{ai:dor relacionada ao cargo}}?
```

- Migração: `script_templates.slots jsonb` (cache do parsing: `[{key, prompt, max_tokens}]`).
- Parser util `src/lib/templateSlots.ts`:
  - Extrai `{{ai:...}}` e `{{lead.field}}` separadamente.
  - Lead fields → substituição direta.
  - AI slots → 1 chamada Lovable AI por mensagem retornando JSON com todos os slots de uma vez (economia de tokens/latência vs gerar a mensagem inteira).
- Editor de template (UI): textarea com syntax highlight simples + preview lado a lado renderizando com um lead de exemplo.
- Edge function `render-template-slots`:
  - Input: `template_id`, `lead_id`
  - Output: `{ rendered_body, slot_values }`
  - Usa knowledge da company + dados do lead enriquecido como contexto.
- Geração da 1ª mensagem (Fase 1.5) passa a usar este renderer quando a cadência tem template híbrido associado.

---

### Fase 4 — Wizard "Lançar campanha" sobre listas existentes

Nova rota `/lists/:id/launch` — wizard de 4 passos:

1. **Seleção de leads** — checkbox da lista, filtros (enrichment_status, tem email, score), contagem ao vivo.
2. **Cadência + template** — escolher cadência (sugere `default_cadence_id`), preview do template renderizado para 3 leads aleatórios.
3. **Modo de envio** — radio: `Revisar cada mensagem` (cria approvals) | `Full-auto` (respeita guard-rail diário) | `Agendar` (data/hora futura).
4. **Confirmar** — resumo (X leads, cadência Y, modo Z, estimativa de envio); botão "Lançar campanha".

- Botão "Lançar campanha" na linha de cada lista em `LeadLists.tsx`.
- Backend: action `launch-campaign` cria batch de enrollments respeitando o modo escolhido; reusa pipeline da Fase 1.5/2.
- Tabela nova `campaigns` (id, list_id, cadence_id, mode, scheduled_for, created_by, status, totals) para histórico/auditoria.

---

### Organização de listas (complemento da Fase 1)

- Adicionar à `lead_lists`: `tags text[]`, `folder text`, `archived_at timestamptz`.
- UI em `/lists`:
  - Filtro por tag e folder (sidebar leve).
  - Bulk actions: arquivar, mover de folder, exportar CSV.
  - Busca por nome.

---

### Detalhes técnicos

**Migrações (3 separadas, na ordem):**
1. `cadences.auto_approve_first_message`, `auto_approve_max_per_day` + colunas de organização em `lead_lists` (tags, folder, archived_at) + trigger de contadores de `lead_lists`.
2. `script_templates.slots` + nova tabela `campaigns` com RLS por company_id.
3. Trigger `after_enrichment_done` → enfileira geração de 1ª mensagem.

**Edge functions novas:**
- `generate-first-message` — reusa lógica do agent, salva em `cadence_custom_messages`, cria `approval_request`.
- `render-template-slots` — 1 call AI batch para todos slots de um template.
- `launch-campaign` — cria enrollments em lote para o wizard.
- Atualizar `_shared/hitl-gate.ts` para honrar `auto_approve_first_message`.

**Frontend principal:**
- `src/pages/LeadLists.tsx` — folders/tags/arquivar + botão "Lançar campanha".
- `src/pages/CampaignWizard.tsx` (nova).
- `src/pages/Cadences/CadenceForm.tsx` — seção Automação.
- `src/pages/Templates/TemplateEditor.tsx` — editor com preview de slots.
- `src/lib/templateSlots.ts` — parser/renderer client-side.
- Hooks: `useLaunchCampaign`, `useRenderTemplatePreview`, `useUpdateCadenceAutomation`.

**Ordem de execução:** Fase 1.5 → Fase 2 → Fase 3 → Fase 4 → Organização. Cada fase fica utilizável isolada.

Atualizar `.lovable/plan.md` ao final.
