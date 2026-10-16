# Planos de assinatura + módulos adicionais

## O que muda para o admin

**Financeiro / Preços** passa a ter duas seções:

1. **Planos** (substitui a "Assinatura base")
   - Começa com 3 planos: Plano 1 (R$ 700), Plano 2 (R$ 1.000), Plano 3 (R$ 2.000).
   - Tudo editável: criar plano novo, renomear, mudar valor, descrição, ordem e desativar.
   - Por enquanto os planos só diferem no preço (mesmas funções).

2. **Módulos adicionais** (mantidos como estão)
   - Vendidos à parte: MunicipIA e Enriquecimento de redes.
   - **Bitrix24, Apollo, Pipedrive, Cal.com e Gmail** saem da lista de venda e passam a vir **inclusos em todos os planos**. Ficam ocultos na tela de preços, com uma linha informativa "Inclusos em todos os planos".

**Página da empresa → aba Assinatura**
- Escolher o plano da empresa e marcar os módulos adicionais.
- Valores vêm de Financeiro / Preços; total mensal = plano + módulos.
- Passa a ser salvo de verdade (deixa de ser só prévia). Cobrança pelo Asaas continua na próxima etapa.

## Sugestão de nomes (opcional)
Essencial / Profissional / Enterprise — ou Start / Growth / Scale. Fica "Plano 1, 2, 3" até você decidir; dá para renomear no painel.

## Detalhes técnicos
- Nova tabela `billing_plans` (id, name, description, price_cents, active, sort_order), RLS só master_admin, seed com os 3 planos.
- `billing_catalog`: adicionar coluna `included_in_plans boolean default false`; marcar bitrix24/apollo/pipedrive/calcom/gmail como incluídos; o item `core` deixa de ser usado (comentário DEPRECATED).
- Nova tabela `company_subscriptions` (company_id único, plan_id, module_keys text[], status, updated_at), RLS master_admin.
- `Pricing.tsx`: seção de planos com CRUD; módulos filtrados por `included_in_plans = false`.
- `CompanyPage.tsx`: substituir o catálogo fixo por dados do banco e salvar em `company_subscriptions`.
- Versão beta 0.83 e patch log.
