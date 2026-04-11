

## Scraping de Website do Prospect com Insights para SDR

### Conceito
Adicionar um botão "Analisar Website" no detalhe do lead que, quando o lead tem website preenchido, faz scraping do site e gera insights de vendas usando IA. Os insights ficam salvos no banco para consulta futura e são usados automaticamente pelo `cadence-executor` na personalização das mensagens.

### Implementação

**1. Migration — tabela `lead_insights`**
```sql
CREATE TABLE lead_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  website_url text,
  insights jsonb NOT NULL DEFAULT '{}',
  raw_summary text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE lead_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can manage lead_insights"
  ON lead_insights FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));
```

O JSON `insights` terá estrutura: `{ proposta_valor, produtos, diferenciais, publico_alvo, cases, pain_points, oportunidades_abordagem }`.

**2. Edge Function `analyze-lead-website`**
- Recebe `lead_id`, busca o lead e seu website
- Faz fetch do HTML do site (reaproveitando a lógica do `extract-knowledge`)
- Envia para IA com prompt específico de SDR: extrair proposta de valor, dores que resolve, diferenciais, e gerar 3 sugestões de abordagem personalizada
- Salva resultado na tabela `lead_insights`
- Retorna os insights

**3. Hook `useLeadInsights`**
- `useLeadInsights(leadId)` — busca insights existentes
- `useAnalyzeWebsite()` — mutation que chama a edge function

**4. UI — Seção "Insights" no `LeadDetail.tsx`**
- Se o lead tem website: botão "Analisar Website" com ícone de lupa
- Se já tem insights salvos: exibe resumo da empresa, diferenciais, e sugestões de abordagem em cards organizados
- Se não tem website: mensagem indicando que precisa preencher o website primeiro

**5. Integração com `cadence-executor`**
- Ao gerar mensagem personalizada, buscar `lead_insights` do lead e incluir no contexto da IA, permitindo mensagens muito mais assertivas no primeiro contato

### Resultado
O SDR poderá, com um clique, obter uma análise completa do prospect antes de iniciar contato. As cadências automáticas também usarão esses insights para personalizar mensagens.

