
-- 1) lead_lists
CREATE TABLE public.lead_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'csv',
  file_name text,
  notes text,
  default_cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  lead_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_lists_source_chk CHECK (source IN ('csv','pipedrive','manual','api'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_lists TO authenticated;
GRANT ALL ON public.lead_lists TO service_role;

ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_lists company members select"
  ON public.lead_lists FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "lead_lists company members insert"
  ON public.lead_lists FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "lead_lists company members update"
  ON public.lead_lists FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "lead_lists company members delete"
  ON public.lead_lists FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE TRIGGER trg_lead_lists_updated_at
  BEFORE UPDATE ON public.lead_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lead_lists_company ON public.lead_lists(company_id, created_at DESC);

-- 2) leads.lead_list_id
ALTER TABLE public.leads
  ADD COLUMN lead_list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_lead_list ON public.leads(lead_list_id) WHERE lead_list_id IS NOT NULL;

-- 3) approval_requests.batch_id
ALTER TABLE public.approval_requests
  ADD COLUMN batch_id uuid;
CREATE INDEX idx_approval_requests_batch ON public.approval_requests(batch_id) WHERE batch_id IS NOT NULL;

-- 4) cadence_enrollments.first_message_status
ALTER TABLE public.cadence_enrollments
  ADD COLUMN first_message_status text;
ALTER TABLE public.cadence_enrollments
  ADD CONSTRAINT cadence_enrollments_first_message_status_chk
  CHECK (first_message_status IS NULL OR first_message_status IN
    ('pending_enrichment','generating','pending_approval','approved','sent','skipped','failed'));
CREATE INDEX idx_cadence_enrollments_first_msg_status
  ON public.cadence_enrollments(first_message_status)
  WHERE first_message_status IS NOT NULL;
