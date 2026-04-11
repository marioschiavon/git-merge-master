CREATE TABLE public.lead_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  website_url text,
  insights jsonb NOT NULL DEFAULT '{}',
  raw_summary text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.lead_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can manage lead_insights"
  ON public.lead_insights FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE INDEX idx_lead_insights_lead_id ON public.lead_insights(lead_id);
CREATE INDEX idx_lead_insights_company_id ON public.lead_insights(company_id);