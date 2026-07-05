
-- 1) apollo_api_calls
CREATE TABLE public.apollo_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  status_code int,
  credits_consumed int,
  latency_ms int NOT NULL DEFAULT 0,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_apollo_calls_company_created ON public.apollo_api_calls (company_id, created_at DESC);
CREATE INDEX idx_apollo_calls_company_endpoint ON public.apollo_api_calls (company_id, endpoint);

GRANT SELECT, INSERT ON public.apollo_api_calls TO authenticated;
GRANT ALL ON public.apollo_api_calls TO service_role;

ALTER TABLE public.apollo_api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members read apollo calls"
  ON public.apollo_api_calls FOR SELECT
  TO authenticated
  USING (
    public.get_user_company_id(auth.uid()) = company_id
    OR public.has_role(auth.uid(), 'master_admin'::app_role)
  );

CREATE POLICY "Company members insert apollo calls"
  ON public.apollo_api_calls FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_company_id(auth.uid()) = company_id
    OR public.has_role(auth.uid(), 'master_admin'::app_role)
  );

-- 2) apollo_search_cache
CREATE TABLE public.apollo_search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  query_hash text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_entries int,
  page int NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, query_hash, page)
);
CREATE INDEX idx_apollo_cache_expires ON public.apollo_search_cache (expires_at);
CREATE INDEX idx_apollo_cache_company ON public.apollo_search_cache (company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apollo_search_cache TO authenticated;
GRANT ALL ON public.apollo_search_cache TO service_role;

ALTER TABLE public.apollo_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members manage apollo cache"
  ON public.apollo_search_cache FOR ALL
  TO authenticated
  USING (
    public.get_user_company_id(auth.uid()) = company_id
    OR public.has_role(auth.uid(), 'master_admin'::app_role)
  )
  WITH CHECK (
    public.get_user_company_id(auth.uid()) = company_id
    OR public.has_role(auth.uid(), 'master_admin'::app_role)
  );

-- 3) leads.apollo_person_id
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS apollo_person_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_apollo_person
  ON public.leads (company_id, apollo_person_id)
  WHERE apollo_person_id IS NOT NULL;
