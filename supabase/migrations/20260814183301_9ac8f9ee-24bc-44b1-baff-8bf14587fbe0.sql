CREATE TABLE public.email_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id uuid,
  conversation_id uuid,
  recipient_email text NOT NULL,
  subject text,
  provider text NOT NULL DEFAULT 'nylas',
  from_email text,
  status text NOT NULL DEFAULT 'queued',
  error_message text,
  provider_message_id text,
  attempt integer NOT NULL DEFAULT 1,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_delivery_log_status_check CHECK (status = ANY (ARRAY['queued','sent','failed']))
);

CREATE INDEX idx_email_delivery_log_lead ON public.email_delivery_log (lead_id, created_at DESC);
CREATE INDEX idx_email_delivery_log_company ON public.email_delivery_log (company_id, created_at DESC);

GRANT SELECT ON public.email_delivery_log TO authenticated;
GRANT ALL ON public.email_delivery_log TO service_role;

ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company email delivery log"
ON public.email_delivery_log FOR SELECT TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));