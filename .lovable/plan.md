
# SDR Automation SaaS — Plano Completo

## Visão Geral
SaaS B2B multi-tenant que automatiza prospecção, follow-up e agendamento de reuniões, substituindo SDRs humanos. Design light/clean estilo HubSpot. Integração real com Pipedrive, WhatsApp, LinkedIn, Email e Telefonia.

---

## Fase 1 — Fundação (Multi-tenant + Auth + Layout)

### 1.1 Design System
- Theme claro e limpo (estilo HubSpot/Pipedrive)
- Cores primárias em azul profissional, tipografia clean (Inter)
- Sidebar de navegação + top bar com contexto da empresa

### 1.2 Autenticação e Multi-tenancy
- Lovable Cloud (Supabase) para auth com email/senha
- Tabela `companies` (tenants) com isolamento total via RLS
- Tabela `user_roles` com enum: `master_admin`, `company_admin`, `user`
- Tabela `company_members` ligando usuários a empresas
- RLS em todas as tabelas filtrando por `company_id`

### 1.3 Painel Master Admin
- Lista de empresas (criar, ativar, desativar)
- Métricas gerais da plataforma
- Gestão de planos/limites por empresa

### 1.4 Painel da Empresa
- Dashboard com KPIs (leads ativos, mensagens enviadas, reuniões agendadas)
- Gestão de usuários da empresa
- Configurações e integrações

---

## Fase 2 — Integração Pipedrive

### 2.1 Conexão OAuth
- Cada empresa conecta sua conta Pipedrive
- Armazena tokens por empresa (tabela `integrations`)
- Edge Function para OAuth flow e refresh de tokens

### 2.2 Sincronização de Leads
- Importa leads/deals do Pipedrive
- Tabela `leads` com dados sincronizados
- Sync periódico via Edge Function + cron
- Atualiza status e atividades de volta no Pipedrive

### 2.3 Visualização de Leads
- Lista de leads com filtros (status, origem, score)
- Detalhe do lead com histórico de interações
- Timeline de atividades

---

## Fase 3 — Motor de Cadência

### 3.1 Configuração de Cadências
- Tabela `cadences` com passos sequenciais
- Cada passo define: canal, delay, template de mensagem
- Canais: LinkedIn, WhatsApp, Email, Ligação
- Interface drag-and-drop para montar sequência

### 3.2 Execução Automática
- Tabela `lead_cadence_executions` (status de cada lead em cada passo)
- Edge Function scheduler que processa filas
- Envia mensagens no canal correto
- Registra cada interação na timeline do lead

### 3.3 Templates de Mensagem
- Biblioteca de templates por canal
- Variáveis dinâmicas (nome, empresa, cargo)
- Suporte a testes A/B

---

## Fase 4 — Integrações de Canais

### 4.1 Email
- Integração via SMTP ou API (configurável por empresa)
- Tracking de abertura e cliques
- Templates HTML responsivos

### 4.2 WhatsApp
- Integração via WhatsApp Business API (Meta Cloud API)
- Edge Function para envio e recebimento
- Templates aprovados pelo WhatsApp

### 4.3 LinkedIn
- Automação via API/extensão
- Envio de convites e mensagens InMail
- Tracking de aceitação

### 4.4 Ligação
- Integração com provedor VoIP (Twilio)
- Click-to-call e registro automático
- Gravação opcional

---

## Fase 5 — Respostas e Agendamento

### 5.1 Detecção de Respostas
- Webhook/polling para capturar respostas por canal
- Classificação automática via AI (interessado, neutro, negativo)
- Pausa automática da cadência quando há resposta

### 5.2 Agendamento de Reuniões
- Integração com Google Calendar / Outlook
- Link de agendamento automático nas mensagens
- Confirmação e lembretes automáticos
- Registra reunião no Pipedrive

---

## Fase 6 — Inteligência e Otimização

### 6.1 Testes A/B
- Variações de mensagens por passo da cadência
- Métricas por variante (resposta, conversão)
- Seleção automática do melhor performer

### 6.2 Relatórios e Analytics
- Dashboard de performance por cadência
- Métricas por canal (taxa de resposta, conversão)
- Relatórios por período, usuário, tipo de lead
- Exportação de dados

---

## Início da Implementação

Começarei pela **Fase 1** — montando o design system, autenticação multi-tenant com perfis de acesso, layout principal com sidebar, e os painéis Master Admin e da Empresa com dados iniciais. Isso cria a base sólida sobre a qual todo o resto será construído.
