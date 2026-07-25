CREATE TABLE public.cadence_execution_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cadence_id uuid NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled')),
  source text NOT NULL DEFAULT 'manual_run',
  scheduled_for timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  locked_at timestamp with time zone,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cadence_execution_queue TO authenticated;
GRANT ALL ON public.cadence_execution_queue TO service_role;

ALTER TABLE public.cadence_execution_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company cadence queue"
  ON public.cadence_execution_queue
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Service role can manage cadence queue"
  ON public.cadence_execution_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_cadence_execution_queue_pending
  ON public.cadence_execution_queue(status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX idx_cadence_execution_queue_cadence
  ON public.cadence_execution_queue(cadence_id, created_at DESC);

CREATE INDEX idx_cadence_execution_queue_company
  ON public.cadence_execution_queue(company_id, created_at DESC);

CREATE UNIQUE INDEX idx_cadence_execution_queue_active_enrollment
  ON public.cadence_execution_queue(enrollment_id)
  WHERE status IN ('pending', 'processing');

CREATE TRIGGER update_cadence_execution_queue_updated_at
  BEFORE UPDATE ON public.cadence_execution_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();