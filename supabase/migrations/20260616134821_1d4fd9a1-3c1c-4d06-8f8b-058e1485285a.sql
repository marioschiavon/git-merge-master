-- HITL config on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hitl_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hitl_scopes jsonb NOT NULL DEFAULT '{"first_message":true,"sdr_reply":true,"cadence_step":true,"sensitive_action":true}'::jsonb;

-- Approval requests table
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('first_message','sdr_reply','cadence_step','sensitive_action')),
  channel text,
  action text NOT NULL DEFAULT 'send',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_payload jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','edited_sent','expired','failed')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  executed_at timestamptz,
  execution_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_company_status ON public.approval_requests(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_lead ON public.approval_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_enrollment ON public.approval_requests(enrollment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view approvals"
  ON public.approval_requests FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Company members can update approvals"
  ON public.approval_requests FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Company members can insert approvals"
  ON public.approval_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Company members can delete approvals"
  ON public.approval_requests FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE TRIGGER approval_requests_updated_at
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.approval_requests REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;