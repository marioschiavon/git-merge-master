ALTER TABLE public.company_email_domains
  ADD COLUMN IF NOT EXISTS inbound_domain text,
  ADD COLUMN IF NOT EXISTS inbound_dns_records jsonb,
  ADD COLUMN IF NOT EXISTS inbound_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inbound_configured_at timestamp with time zone;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS resend_inbound_webhook_id text,
  ADD COLUMN IF NOT EXISTS resend_inbound_webhook_secret text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_email_domains TO authenticated;
GRANT ALL ON public.company_email_domains TO service_role;
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;