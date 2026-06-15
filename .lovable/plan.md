# Leads sem nome (canal corporativo) — cadastro e abordagem

Hoje `leads.name` é obrigatório e a primeira mensagem usa `Olá ${lead.name}`. Listas que trazem só WhatsApp/site/Instagram de empresa forçam o operador a inventar um nome, gerando saudações erradas para a recepcionista.

## Objetivos

1. Permitir cadastrar lead sem nome de pessoa (apenas dados da empresa).
2. Abertura **personalizada com dados da empresa/redes**, mas neutra quanto ao destinatário, pedindo direcionamento ao decisor.
3. Quando alguém responde se identificando, criar **um novo lead-pessoa vinculado à empresa** (sem perder o registro original do canal).

## Mudanças

### 1. Schema (`leads`)
- `name`: continua presente, mas vira **opcional** no app. Para satisfazer o `NOT NULL` legado, gravamos um display gerado: `company_name` → host do `website` → handle do Instagram → `"Contato sem nome"`.
- Novas colunas:
  - `lead_kind text default 'person' check in ('person','company')` — `company` quando o cadastro veio sem nome.
  - `contact_identified boolean default false` — vira `true` quando capturamos o decisor.
  - `parent_company_lead_id uuid references leads(id) on delete set null` — usado nos leads-pessoa criados a partir de um lead-empresa.
- Index parcial em `parent_company_lead_id`.

### 2. Cadastro manual (`LeadFormDialog.tsx`)
- Tornar `name` opcional no schema Zod.
- Validar: precisa de **pelo menos um** entre `name`, `company_name`, `website`, `whatsapp`, `phone`, `instagram_url`, `linkedin_company_url`.
- Ao salvar sem `name`: setar `lead_kind='company'` e calcular `display_name` no submit (envia para o campo `name`).
- Badge "Empresa" na listagem (`Leads.tsx`) quando `lead_kind='company'`.

### 3. Import CSV (`LeadImportDialog.tsx`)
- Remover `if (!out.name) return null` — aceita linha sem nome desde que tenha empresa/site/whatsapp/insta.
- Mesma lógica de `display_name` + `lead_kind='company'`.
- Mostrar contagem "X leads sem nome (modo empresa)" no resumo de import.

### 4. Enriquecimento da empresa (reutilizar pipeline existente)
- Pipeline atual (`enrich-lead`, `analyze-lead-website`, `lead_social_profiles`, `lead_insights`) já roda quando há site/redes. Garantir que dispara também para `lead_kind='company'`.
- O resultado (resumo do site, posts recentes do Instagram, "diferenciais", segmento) fica em `lead_insights` e é o insumo da abertura personalizada.

### 5. Primeira mensagem personalizada (`build-first-message.ts`)
Quando `lead_kind='company'`:
- **Não** usar `${lead.name}` no `userPrompt`. Passar `display_name`, `company_name`, `website`, `instagram_url`, `linkedin_company_url` e o bloco `lead_insights` (resumo + diferenciais detectados).
- Trocar o bloco de regras gerais por instrução específica:

  > *"Você está iniciando contato em um canal corporativo (WhatsApp/Instagram/email da empresa, provavelmente atendido por recepção ou social media). Regras:*
  > *1. NÃO use nome próprio do destinatário (não há nome).*
  > *2. Abra com um gancho personalizado usando 1 observação concreta sobre a EMPRESA — extraída do site, Instagram ou LinkedIn da empresa (ex.: posts recentes, diferencial, segmento, prêmios).*
  > *3. Em 1 frase, conecte esse gancho ao motivo do contato (produto/serviço da nossa empresa).*
  > *4. Encerre pedindo direcionamento para o responsável pela área X (não nome — área/cargo).*
  > *5. Tom cordial, curto (WhatsApp ≤ 70 palavras, email ≤ 80), sem saudação a uma pessoa específica. Use 'vocês' no plural.*
  > *6. Proibido inventar nome de pessoa ou fingir conhecer alguém da empresa."*

- Exemplo de saída esperada (referência para o prompt):
  > *"Olá! Vi no Instagram de vocês o cuidado com o pós-operatório dos pets — chamou atenção. Somos uma rede americana selecionando clínicas parceiras no Brasil para [benefício]. Poderia me direcionar para o responsável por parcerias?"*

- Se `lead_insights` ainda não estiver pronto no momento do envio: fallback para gancho genérico sobre o segmento + pedido de direcionamento (sem inventar fato).

### 6. Captura do decisor (`sdr-agent/index.ts`)
- Após classificação de intent, se `lead.lead_kind='company'` e `lead.contact_identified=false`, rodar extrator que detecta auto-identificação ("Sou o João, gerente…", "Aqui é a Ana do RH", "Pode falar comigo, Maria").
- Quando detectar nome (+ cargo opcional):
  1. `INSERT` em `leads` um novo registro `lead_kind='person'`, `parent_company_lead_id = <empresa>`, herdando `company_id`, `company_name`, `website`, redes, `lead_insights`, `source='referral_from_reception'`.
  2. Marcar empresa: `contact_identified=true`; criar `lead_activities` "decisor identificado: {nome}".
  3. Mover a `conversation` ativa para o novo lead-pessoa (`update conversations.lead_id`) e seguir o diálogo usando o nome real.
  4. Próxima mensagem do agente usa o nome capturado naturalmente ("Prazer, João! …") e reaproveita os mesmos insights da empresa.
- Se a recepcionista só diz "passo o recado / mande por email", agente registra `lead_activities` e mantém follow-up neutro no lead-empresa.

### 7. UI complementar
- `LeadDetail`: quando `parent_company_lead_id` presente, mostrar link "Veio de: {empresa}". No lead-empresa, listar "Pessoas identificadas: …".
- Filtro extra em `/leads`: tipo (Pessoa / Empresa).

## Estrutura técnica

```text
CSV / Form sem nome
        │
        ▼
leads (lead_kind='company', name=display)
        │  enrich-lead → lead_insights (site + redes)
        ▼
cadence step 1 → build-first-message
   (gancho com insight da empresa + pedido de direcionamento)
        │
        ▼
WhatsApp recepção responde "Sou o João, comercial"
        │
        ▼
sdr-agent extrai → cria lead-pessoa (parent=empresa)
        │   move conversation.lead_id, herda lead_insights
        ▼
diálogo segue personalizado com "João" + mesmos insights
```

## Não incluso (fica para depois)

- Detecção automática "número de empresa vs celular pessoal" via Twilio lookup — por ora usamos só presença/ausência do nome.
- Múltiplos decisores simultâneos: primeiro identificado vira lead-pessoa principal; outros viram `lead_activities`.
- Backfill retroativo: leads antigos continuam `lead_kind='person'` (default).
