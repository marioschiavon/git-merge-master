
CREATE TYPE public.email_grant_provider AS ENUM ('google', 'microsoft', 'imap');
CREATE TYPE public.email_grant_status AS ENUM ('active', 'expired', 'revoked', 'error');

CREATE TABLE public.user_email_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider public.email_grant_provider NOT NULL,
  grant_id text NOT NULL,
  email text NOT NULL,
  display_name text,
  status public.email_grant_status NOT NULL DEFAULT 'active',
  scopes text[] DEFAULT ARRAY[]::text[],
  daily_sent_count integer NOT NULL DEFAULT 0,
  daily_sent_date date NOT NULL DEFAULT CURRENT_DATE,
  warmup_started_at timestamptz DEFAULT now(),
  warmup_paused boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

CREATE INDEX idx_user_email_grants_user ON public.user_email_grants(user_id);
CREATE INDEX idx_user_email_grants_company ON public.user_email_grants(company_id);
CREATE INDEX idx_user_email_grants_grant_id ON public.user_email_grants(grant_id);
CREATE INDEX idx_user_email_grants_status ON public.user_email_grants(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_email_grants TO authenticated;
GRANT ALL ON public.user_email_grants TO service_role;

ALTER TABLE public.user_email_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own grants"
  ON public.user_email_grants FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Company members can view company grants"
  ON public.user_email_grants FOR SELECT
  TO authenticated
  USING (public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "Master admin can view all grants"
  ON public.user_email_grants FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role));

CREATE POLICY "Users can insert own grants"
  ON public.user_email_grants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own grants"
  ON public.user_email_grants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own grants"
  ON public.user_email_grants FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Master admin can manage all grants"
  ON public.user_email_grants FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master_admin'::app_role));

CREATE TRIGGER update_user_email_grants_updated_at
  BEFORE UPDATE ON public.user_email_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add email channel selector to cadences (default 'domain' = current Resend flow)
DO $$ BEGIN
  CREATE TYPE public.email_channel AS ENUM ('domain', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS email_channel public.email_channel NOT NULL DEFAULT 'domain',
  ADD COLUMN IF NOT EXISTS email_grant_id uuid REFERENCES public.user_email_grants(id) ON DELETE SET NULL;

-- Track which provider sent each outbound email (nylas vs resend)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS email_provider text;
