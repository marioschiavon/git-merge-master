

# IA para SDR — Scripts Inteligentes, Variações e Conversas

## Visão Geral

Criar um sistema de IA que automatiza o trabalho do SDR em 3 camadas:

1. **Biblioteca de Scripts** — templates de abordagem por segmento/indústria
2. **Motor de IA** — gera variações, adapta tom, personaliza por lead
3. **Conversa Inteligente** — interpreta respostas e sugere/gera a próxima mensagem

Tudo usando Lovable AI (já configurado, sem API key extra).

---

## Arquitetura

```text
┌──────────────────────────────────────────┐
│  UI: Scripts & Conversas                 │
│  - Biblioteca de scripts por segmento    │
│  - Gerador de variações                  │
│  - Inbox com sugestão de resposta        │
└──────────┬───────────────────────────────┘
           │ supabase.functions.invoke()
           ▼
┌──────────────────────────────────────────┐
│  Edge Functions (3 funções)              │
│  1. ai-generate-script → gera script    │
│  2. ai-variations → gera N variações    │
│  3. ai-reply → interpreta + sugere resp │
└──────────┬───────────────────────────────┘
           │ Lovable AI Gateway
           ▼
┌──────────────────────────────────────────┐
│  gemini-3-flash-preview                  │
└──────────────────────────────────────────┘
```

---

## Banco de Dados (Migration)

### Tabela `script_templates`
Armazena scripts base por segmento e canal.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| company_id | uuid FK | Multi-tenant |
| name | text | "Advocacia - Primeiro contato" |
| segment | text | "advocacia", "odontologia", etc |
| channel | cadence_type | email/whatsapp/linkedin |
| tone | text | "formal", "consultivo", "direto" |
| base_script | text | Template com {{variáveis}} |
| created_by | uuid | Usuário que criou |
| is_ai_generated | boolean | Se foi gerado por IA |
| created_at / updated_at | timestamptz | |

### Tabela `script_variations`
Variações geradas pela IA a partir de um script base.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| template_id | uuid FK | Script original |
| variation_text | text | Texto da variação |
| tone | text | Tom aplicado |
| created_at | timestamptz | |

### Tabela `conversations`
Histórico de mensagens enviadas/recebidas por lead.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| company_id | uuid FK | |
| lead_id | uuid FK | |
| cadence_enrollment_id | uuid FK nullable | |
| channel | cadence_type | |
| created_at | timestamptz | |

### Tabela `messages`
Mensagens individuais dentro de uma conversa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| conversation_id | uuid FK | |
| direction | text | "outbound" / "inbound" |
| content | text | Texto da mensagem |
| ai_suggested | boolean | Se foi sugerida pela IA |
| sent_at | timestamptz | |
| metadata | jsonb | Dados extras (tom detectado, etc) |

---

## Edge Functions

### 1. `ai-generate-script`
- Input: segmento, canal, tom desejado, contexto da empresa
- System prompt com conhecimento de vendas B2B brasileiras
- Output: script completo com placeholders {{nome}}, {{empresa}}, etc

### 2. `ai-variations`
- Input: script base, quantidade de variações, tons alternativos
- Gera N versões mantendo a essência mas variando abordagem/tom
- Output: array de variações

### 3. `ai-reply`
- Input: histórico da conversa, dados do lead (segmento, empresa)
- Analisa tom da resposta do lead (interesse, objeção, dúvida, rejeição)
- Sugere próxima mensagem adequada
- Output: { tone_detected, sentiment, suggested_reply, reasoning }

---

## Interface (UI)

### Nova página: "Scripts IA"
- Lista de scripts por segmento com filtros
- Botão "Gerar com IA" — wizard com segmento + canal + tom
- Visualizar script gerado e salvar na biblioteca
- Botão "Gerar Variações" — cria 3-5 versões de um script

### Na CadenceDetail (aba Steps)
- Botão "Preencher com IA" ao lado do template de cada step
- Seleciona script da biblioteca ou gera na hora

### Nova aba "Conversas" (ou dentro de Leads)
- Inbox com histórico de mensagens por lead
- Para cada resposta recebida: badge com tom detectado
- Botão "Sugerir Resposta" que chama a IA

---

## Segmentos pré-configurados

Scripts base seed para: Advocacia, Odontologia, Contabilidade, Tecnologia, Consultoria, Varejo, Indústria — cada um com tom e vocabulário adequado.

---

## Resumo de Entregas

1. Migration com 4 tabelas + RLS
2. 3 Edge Functions com Lovable AI
3. Página "Scripts IA" com geração e variações
4. Integração com Cadências (preencher steps)
5. Inbox de conversas com sugestão de resposta IA

