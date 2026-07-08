
CREATE TABLE public.company_email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  sending_domain text NOT NULL,
  from_name text,
  from_email text,
  reply_to text,
  resend_domain_id text,
  status text NOT NULL DEFAULT 'pending',
  dns_records jsonb,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_email_domains TO authenticated;
GRANT ALL ON public.company_email_domains TO service_role;

ALTER TABLE public.company_email_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_email_domains select" ON public.company_email_domains
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'master_admin'::app_role)
  OR public.get_user_company_id(auth.uid()) = company_id
);

CREATE POLICY "company_email_domains admin write" ON public.company_email_domains
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(),'company_admin'::app_role))
)
WITH CHECK (
  public.has_role(auth.uid(),'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(),'company_admin'::app_role))
);

CREATE TRIGGER trg_company_email_domains_updated
BEFORE UPDATE ON public.company_email_domains
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Consolidar messages: copiar gmail_message_id -> provider_message_id se vazio, e drop
UPDATE public.messages
SET provider_message_id = gmail_message_id
WHERE provider_message_id IS NULL AND gmail_message_id IS NOT NULL;

ALTER TABLE public.messages DROP COLUMN gmail_message_id;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_provider text;

-- Drop Gmail
DROP FUNCTION IF EXISTS public.set_gmail_oauth_tokens(uuid, text, text, text, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.get_gmail_oauth_tokens(uuid, text);
DROP FUNCTION IF EXISTS public.update_gmail_access_token(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.mark_gmail_error(uuid, text);
DROP TABLE IF EXISTS public.gmail_account CASCADE;
