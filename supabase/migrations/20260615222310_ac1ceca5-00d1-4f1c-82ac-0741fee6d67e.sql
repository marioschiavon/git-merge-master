ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_kind text NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS contact_identified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_company_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_lead_kind_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_lead_kind_check CHECK (lead_kind IN ('person','company'));

CREATE INDEX IF NOT EXISTS idx_leads_parent_company ON public.leads(parent_company_lead_id) WHERE parent_company_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_kind_company ON public.leads(company_id, lead_kind) WHERE lead_kind = 'company';