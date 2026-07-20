
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id UUID,
  user_email TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error','critical')),
  entity_type TEXT,
  entity_id TEXT,
  message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_company_idx ON public.audit_logs (company_id, created_at DESC);
CREATE INDEX audit_logs_severity_idx ON public.audit_logs (severity, created_at DESC);
CREATE INDEX audit_logs_event_type_idx ON public.audit_logs (event_type, created_at DESC);
CREATE INDEX audit_logs_user_idx ON public.audit_logs (user_id, created_at DESC);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master admins can read all audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'master_admin'::app_role));

-- Cleanup old logs (>90 days)
CREATE OR REPLACE FUNCTION public.cleanup_audit_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.audit_logs WHERE created_at < now() - interval '90 days';
$$;
