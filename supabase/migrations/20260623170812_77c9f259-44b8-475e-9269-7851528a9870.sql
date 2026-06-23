
-- 1) Cadences: auto-approval controls
ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS auto_approve_first_message boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_max_per_day integer NOT NULL DEFAULT 50;

-- 2) Lead lists: organization
ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS folder text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lead_lists_folder ON public.lead_lists(company_id, folder) WHERE folder IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_lists_archived ON public.lead_lists(company_id, archived_at);

-- 3) Script templates: hybrid AI slots cache
ALTER TABLE public.script_templates
  ADD COLUMN IF NOT EXISTS slots jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 4) Add 'pending_generation' to first_message_status set
ALTER TABLE public.cadence_enrollments
  DROP CONSTRAINT IF EXISTS cadence_enrollments_first_message_status_chk;
ALTER TABLE public.cadence_enrollments
  ADD CONSTRAINT cadence_enrollments_first_message_status_chk
  CHECK (first_message_status IS NULL OR first_message_status IN
    ('pending_generation','generating','pending_approval','auto_approved','approved','sent','failed','skipped'));

-- 5) Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL,
  cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('review','auto','scheduled')),
  scheduled_for timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','completed','cancelled')),
  total_leads integer NOT NULL DEFAULT 0,
  enrolled_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view campaigns"
  ON public.campaigns FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Company members can manage campaigns"
  ON public.campaigns FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_campaigns_company ON public.campaigns(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_list ON public.campaigns(list_id);

-- 6) Trigger: after enrichment done, auto-enroll into list's default cadence
CREATE OR REPLACE FUNCTION public.after_enrichment_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_list_id uuid;
  v_company_id uuid;
  v_cadence_id uuid;
  v_existing uuid;
BEGIN
  IF NEW.status <> 'done' OR (TG_OP = 'UPDATE' AND OLD.status = 'done') THEN
    RETURN NEW;
  END IF;

  SELECT lead_list_id, company_id INTO v_lead_list_id, v_company_id
  FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead_list_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT default_cadence_id INTO v_cadence_id
  FROM public.lead_lists WHERE id = v_lead_list_id;
  IF v_cadence_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if there is already an enrollment for this lead+cadence
  SELECT id INTO v_existing FROM public.cadence_enrollments
   WHERE lead_id = NEW.lead_id AND cadence_id = v_cadence_id
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cadence_enrollments (
    company_id, lead_id, cadence_id, status, first_message_status, current_step, enrolled_at
  ) VALUES (
    v_company_id, NEW.lead_id, v_cadence_id, 'active', 'pending_generation', 0, now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_enrichment_done ON public.lead_enrichment_jobs;
CREATE TRIGGER trg_after_enrichment_done
  AFTER INSERT OR UPDATE OF status ON public.lead_enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.after_enrichment_done();
