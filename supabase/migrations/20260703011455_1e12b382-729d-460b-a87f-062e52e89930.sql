
-- Enable pgcrypto for pgp_sym_encrypt/decrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Status enum
DO $$ BEGIN
  CREATE TYPE public.hook7_instance_status AS ENUM (
    'pending_qr','qr_ready','pairing','connected','disconnected','banned','error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. TABLE
CREATE TABLE IF NOT EXISTS public.hook7_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  external_id text,
  external_name text,
  status public.hook7_instance_status NOT NULL DEFAULT 'pending_qr',
  phone_number text,
  connected_profile_name text,
  token_encrypted bytea,
  last_connected_at timestamptz,
  last_qr_at timestamptz,
  user_disconnected_at timestamptz,
  archived_at timestamptz,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hook7_instances_company ON public.hook7_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_hook7_instances_status  ON public.hook7_instances(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hook7_instances_external_id
  ON public.hook7_instances(external_id) WHERE external_id IS NOT NULL;

-- 2. GRANTS (token_encrypted NEVER exposed to authenticated)
GRANT SELECT (id, company_id, owner_user_id, display_name, external_id, external_name,
              status, phone_number, connected_profile_name,
              last_connected_at, last_qr_at, user_disconnected_at, archived_at, last_error,
              created_by, created_at, updated_at)
  ON public.hook7_instances TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hook7_instances TO authenticated;
GRANT ALL ON public.hook7_instances TO service_role;

-- 3. RLS
ALTER TABLE public.hook7_instances ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES
CREATE POLICY "members view company hook7 instances"
  ON public.hook7_instances FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR company_id = public.get_user_company_id(auth.uid())
  );

CREATE POLICY "company admins manage hook7 instances"
  ON public.hook7_instances FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND public.has_role(auth.uid(), 'company_admin'::app_role)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR (
      company_id = public.get_user_company_id(auth.uid())
      AND public.has_role(auth.uid(), 'company_admin'::app_role)
    )
  );

-- 5. updated_at trigger
DROP TRIGGER IF EXISTS trg_hook7_instances_updated_at ON public.hook7_instances;
CREATE TRIGGER trg_hook7_instances_updated_at
  BEFORE UPDATE ON public.hook7_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Token get/set via SECURITY DEFINER (passphrase read from Vault or GUC)
-- Uses a GUC set at request time by edge functions via set_config('app.hook7_token_passphrase', ...)
CREATE OR REPLACE FUNCTION public.set_hook7_instance_token(_instance_id uuid, _token text, _passphrase text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  UPDATE public.hook7_instances
  SET token_encrypted = pgp_sym_encrypt(_token, _passphrase),
      updated_at = now()
  WHERE id = _instance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hook7_instance_token(_instance_id uuid, _passphrase text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token text; v_enc bytea;
BEGIN
  SELECT token_encrypted INTO v_enc FROM public.hook7_instances WHERE id = _instance_id;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  v_token := pgp_sym_decrypt(v_enc, _passphrase);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.set_hook7_instance_token(uuid, text, text) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.get_hook7_instance_token(uuid, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_hook7_instance_token(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_hook7_instance_token(uuid, text) TO service_role;

-- 7. platform_settings.hook7_base_url (JSON in settings blob assumed)
-- platform_settings is a singleton; add a column if not present.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS hook7_base_url text NOT NULL DEFAULT 'https://api.hook7.com.br';
