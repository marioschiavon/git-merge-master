
-- 1. Add native columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS secondary_email text,
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS mobile_phone text,
  ADD COLUMN IF NOT EXISTS corporate_phone text,
  ADD COLUMN IF NOT EXISTS seniority text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS employee_count integer,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enrichment_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Indexes for future filtering
CREATE INDEX IF NOT EXISTS idx_leads_company_industry ON public.leads (company_id, industry);
CREATE INDEX IF NOT EXISTS idx_leads_company_seniority ON public.leads (company_id, seniority);
CREATE INDEX IF NOT EXISTS idx_leads_company_city ON public.leads (company_id, city);

-- 3. Best-effort backfill from pipedrive_data.csv_import (only when native col is NULL)
UPDATE public.leads SET
  first_name       = COALESCE(first_name,       NULLIF(pipedrive_data->'csv_import'->>'first_name', '')),
  last_name        = COALESCE(last_name,        NULLIF(pipedrive_data->'csv_import'->>'last_name', '')),
  secondary_email  = COALESCE(secondary_email,  NULLIF(pipedrive_data->'csv_import'->>'secondary_email', '')),
  personal_email   = COALESCE(personal_email,   NULLIF(pipedrive_data->'csv_import'->>'personal_email', '')),
  mobile_phone     = COALESCE(mobile_phone,     NULLIF(pipedrive_data->'csv_import'->>'mobile_phone', '')),
  corporate_phone  = COALESCE(corporate_phone,  NULLIF(pipedrive_data->'csv_import'->>'corporate_phone', '')),
  seniority        = COALESCE(seniority,        NULLIF(pipedrive_data->'csv_import'->>'seniority', '')),
  department       = COALESCE(department,       NULLIF(pipedrive_data->'csv_import'->>'department', '')),
  industry         = COALESCE(industry,         NULLIF(pipedrive_data->'csv_import'->>'industry', '')),
  city             = COALESCE(city,             NULLIF(pipedrive_data->'csv_import'->>'city', '')),
  state            = COALESCE(state,            NULLIF(pipedrive_data->'csv_import'->>'state', '')),
  country          = COALESCE(country,          NULLIF(pipedrive_data->'csv_import'->>'country', ''))
WHERE pipedrive_data ? 'csv_import';

-- employee_count: parse numeric from JSON string
UPDATE public.leads SET
  employee_count = NULLIF(regexp_replace(pipedrive_data->'csv_import'->>'employee_count', '[^0-9]', '', 'g'), '')::int
WHERE employee_count IS NULL
  AND pipedrive_data->'csv_import' ? 'employee_count'
  AND pipedrive_data->'csv_import'->>'employee_count' ~ '\d';

-- tags: split comma/semicolon-separated string
UPDATE public.leads SET
  tags = (
    SELECT COALESCE(array_agg(t), '{}')
    FROM (
      SELECT trim(unnest(regexp_split_to_array(pipedrive_data->'csv_import'->>'tags', '[,;]'))) AS t
    ) s
    WHERE t <> ''
  )
WHERE (tags IS NULL OR array_length(tags, 1) IS NULL)
  AND pipedrive_data->'csv_import' ? 'tags'
  AND length(trim(coalesce(pipedrive_data->'csv_import'->>'tags',''))) > 0;
