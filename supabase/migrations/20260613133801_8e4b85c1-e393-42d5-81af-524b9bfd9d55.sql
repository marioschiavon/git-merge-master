
CREATE TABLE IF NOT EXISTS public.pending_inbound_runs (
  lead_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  conversation_id uuid,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_inbound_runs_status_sched
  ON public.pending_inbound_runs (status, scheduled_at);

GRANT ALL ON public.pending_inbound_runs TO service_role;

ALTER TABLE public.pending_inbound_runs ENABLE ROW LEVEL SECURITY;

-- No client policies: this table is service_role only (managed by edge functions).
CREATE POLICY "service role only" ON public.pending_inbound_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_pending_inbound_runs_updated
  BEFORE UPDATE ON public.pending_inbound_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
