

# SDR Autônomo — Sistema Sem Intervenção Humana

## Visão Geral

Transformar o sistema atual (manual) em um **SDR autônomo** que executa cadências sozinho: envia mensagens, interpreta respostas, e persegue o objetivo de **agendar reunião** — sem intervenção humana.

## Arquitetura

```text
┌─────────────────────────────────────────────────┐
│  Base de Conhecimento (por empresa)             │
│  - Texto livre (produto, proposta de valor)     │
│  - Upload de docs (PDF, DOCX)                   │
│  - URL do site (scraping via IA)                │
└──────────────┬──────────────────────────────────┘
               │ contexto para todas as mensagens
               ▼
┌─────────────────────────────────────────────────┐
│  Motor de Execução (Edge Function agendada)     │
│  cadence-executor — roda a cada 5 min via cron  │
│  1. Busca enrollments ativos no step atual      │
│  2. Verifica delay_days cumprido                │
│  3. Gera mensagem personalizada com IA          │
│  4. Envia pelo canal do step (email/whatsapp)   │
│  5. Avança current_step ou marca completed      │
└──────────────┬──────────────────────────────────┘
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
  Email    WhatsApp    LinkedIn
 (Resend)  (Twilio)   (futuro)
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Webhooks de Resposta                           │
│  - Twilio webhook → recebe respostas WhatsApp   │
│  - Email reply tracking (futuro)                │
│  Salva em messages, chama ai-reply              │
│  Se detecta interesse → agenda reunião          │
│  Se objeção → gera contra-argumento             │
│  Se rejeição → pausa enrollment                 │
└─────────────────────────────────────────────────┘
```

## Banco de Dados (Migration)

### Tabela `company_knowledge`
Base de conhecimento do produto por empresa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| company_id | uuid FK | |
| type | text | "text", "document", "url" |
| title | text | Nome do item |
| content | text | Conteúdo extraído/digitado |
| source_url | text nullable | URL original |
| file_path | text nullable | Path no storage |
| created_at | timestamptz | |

### Tabela `execution_logs`
Log de cada ação automática executada.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| company_id | uuid FK | |
| enrollment_id | uuid FK | |
| step_id | uuid FK | |
| lead_id | uuid FK | |
| channel | text | email/whatsapp/linkedin |
| action | text | "sent", "replied", "scheduled", "paused" |
| message_content | text | Mensagem enviada |
| ai_context | jsonb | Dados da análise IA |
| created_at | timestamptz | |

### Alterações em `cadence_enrollments`
- Adicionar `last_executed_at timestamptz` — quando o último step foi executado
- Adicionar `next_execution_at timestamptz` — quando o próximo deve executar
- Adicionar `meeting_scheduled boolean default false`

### Storage bucket `knowledge-docs`
Para upload de PDFs e documentos.

## Edge Functions

### 1. `cadence-executor` (agendada via pg_cron — a cada 5 min)
- Busca enrollments com `status = active` e `next_execution_at <= now()`
- Para cada um:
  - Carrega o step atual, script template, knowledge da empresa
  - Chama a IA para gerar mensagem personalizada com dados do lead
  - Envia pelo canal correto (Twilio/Email)
  - Salva em `messages` e `execution_logs`
  - Avança `current_step` e calcula `next_execution_at`
  - Se era último step, marca `status = completed`

### 2. `inbound-webhook` (recebe respostas)
- Twilio envia POST quando lead responde no WhatsApp
- Salva mensagem inbound em `messages`
- Chama `ai-reply` para analisar sentimento
- **Se interesse/reunião**: pausa cadência, marca `meeting_scheduled`, cria atividade
- **Se objeção**: gera contra-argumento e envia automaticamente
- **Se rejeição**: pausa cadência, registra
- **Se dúvida**: responde e mantém cadência

### 3. `extract-knowledge` (extrai conteúdo de URL)
- Recebe URL, faz scraping via IA (Firecrawl ou fetch + parse)
- Extrai proposta de valor, features, diferenciais
- Salva em `company_knowledge`

### 4. `parse-knowledge-doc` (processa upload)
- Recebe file do storage, extrai texto
- Salva conteúdo em `company_knowledge`

## Interface (UI)

### Nova página: "Base de Conhecimento" (`/knowledge`)
- 3 abas: **Texto** | **Documentos** | **URLs**
- Texto: campo rico para descrever produto, proposta de valor, diferenciais
- Documentos: upload de PDFs com extração automática
- URLs: colar URL do site, IA extrai e resume

### Atualização da página Cadências
- Botão **"Ativar Automação"** na cadência — muda status para `active` e começa execução
- Dashboard de execução: quantos leads em cada step, quantos responderam, reuniões agendadas
- Log de atividades em tempo real por enrollment

### Atualização da página Conversas
- Filtro "Automáticas" para ver conversas gerenciadas pela IA
- Flag visual quando IA respondeu automaticamente
- Botão "Assumir manualmente" para pausar automação em um lead específico

## Configuração de Canais (preparação)
Como você ainda não tem canais configurados, a arquitetura fica pronta para plug-and-play:
- **Email**: Conector Resend disponível — conecta quando quiser
- **WhatsApp/Ligações**: Conector Twilio disponível — conecta quando quiser
- **LinkedIn**: Sem API oficial — fica como "manual" ou integração futura

## Ordem de Implementação

1. **Base de Conhecimento** — tabela + storage + UI para treinar a IA
2. **Motor de Execução** — edge function agendada + colunas de controle
3. **Logs e Dashboard** — tabela de logs + visualização na UI
4. **Webhook de Respostas** — receber e processar respostas automaticamente
5. **Canais** — conectar Twilio/Resend quando o usuário estiver pronto

## Resumo de Entregas
- 1 migration (2 tabelas novas + alterações em enrollments + storage bucket)
- 4 edge functions novas
- 1 cron job (pg_cron + pg_net)
- 1 página nova (Knowledge)
- Atualizações em Cadências e Conversas

