
-- 1) Lead columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS linkedin_company_url text,
  ADD COLUMN IF NOT EXISTS enrichment_status text,
  ADD COLUMN IF NOT EXISTS enrichment_updated_at timestamptz;

-- 2) Companies settings
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS enrichment_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Apify provider enum value
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'apify';

-- 4) lead_enrichment_jobs
CREATE TABLE IF NOT EXISTS public.lead_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed
  steps_done jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lej_company ON public.lead_enrichment_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_lej_status_next ON public.lead_enrichment_jobs(status, next_run_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lej_lead_open ON public.lead_enrichment_jobs(lead_id)
  WHERE status IN ('pending','processing');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_enrichment_jobs TO authenticated;
GRANT ALL ON public.lead_enrichment_jobs TO service_role;
ALTER TABLE public.lead_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage company enrichment jobs"
  ON public.lead_enrichment_jobs FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));

CREATE TRIGGER trg_lej_updated BEFORE UPDATE ON public.lead_enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) lead_social_profiles
CREATE TABLE IF NOT EXISTS public.lead_social_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  network text NOT NULL, -- instagram|facebook|linkedin_person|linkedin_company
  handle text,
  url text,
  bio text,
  followers int,
  recent_posts jsonb,
  raw jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, network)
);
CREATE INDEX IF NOT EXISTS idx_lsp_company ON public.lead_social_profiles(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_social_profiles TO authenticated;
GRANT ALL ON public.lead_social_profiles TO service_role;
ALTER TABLE public.lead_social_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage company social profiles"
  ON public.lead_social_profiles FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));

CREATE TRIGGER trg_lsp_updated BEFORE UPDATE ON public.lead_social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Auto-enqueue trigger on lead insert
CREATE OR REPLACE FUNCTION public.enqueue_lead_enrichment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb;
BEGIN
  SELECT enrichment_settings INTO s FROM public.companies WHERE id = NEW.company_id;
  IF s IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((s->>'website_analysis')::bool, false)
     OR COALESCE((s->>'discover_socials')::bool, false)
     OR COALESCE((s->>'apify_scrape')::bool, false)
     OR COALESCE((s->>'generate_message')::bool, false) THEN
    INSERT INTO public.lead_enrichment_jobs (lead_id, company_id)
    VALUES (NEW.id, NEW.company_id)
    ON CONFLICT (lead_id) WHERE status IN ('pending','processing') DO NOTHING;
    UPDATE public.leads SET enrichment_status = 'pending', enrichment_updated_at = now()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_enqueue_enrichment ON public.leads;
CREATE TRIGGER trg_leads_enqueue_enrichment
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_lead_enrichment();
