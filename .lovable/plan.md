

# Próximos Passos — Fase 3

Com a integração Pipedrive funcionando, a prioridade natural é dar vida às **Cadências de Outreach** e ao **Dashboard com dados reais**.

---

## Opção A: Cadências de Outreach (maior impacto)

Transformar a página vazia de Cadências em um sistema funcional:

- **Tabela `cadences`**: nome, tipo (email/whatsapp/linkedin/multi-channel), status (draft/active/paused), company_id
- **Tabela `cadence_steps`**: cadence_id, step_order, channel, template, delay_days
- **Tabela `cadence_enrollments`**: lead_id, cadence_id, current_step, status (active/completed/replied/bounced)
- UI para criar cadência com steps arrastáveis
- Associar leads a cadências
- Visualizar progresso dos leads em cada cadência

## Opção B: Dashboard com Métricas Reais

- Cards com: total leads, leads novos (7d), por status, taxa de conversão
- Gráfico de leads importados por dia/semana
- Últimas atividades
- Status da integração Pipedrive

## Opção C: Ações nos Leads

- Alterar status do lead manualmente
- Adicionar notas e atividades
- Atribuir lead a membro da equipe

---

## Recomendação

Implementar na ordem **A → B → C** para entregar valor rapidamente: as cadências são o core do produto SDR.

Qual opção deseja implementar primeiro?

