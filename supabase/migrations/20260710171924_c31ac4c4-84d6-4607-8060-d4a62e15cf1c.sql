-- Cal.com multi-tenant credentials on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS calcom_api_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS calcom_booking_link text,
  ADD COLUMN IF NOT EXISTS calcom_webhook_secret text,
  ADD COLUMN IF NOT EXISTS calcom_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS calcom_last_error text;

-- Save encrypted Cal.com API key for a company. Only company_admin of that
-- company (or master_admin) can call this. Passphrase must be supplied by
-- the caller (edge function reads it from env).
CREATE OR REPLACE FUNCTION public.set_calcom_api_key(
  _company_id uuid,
  _api_key text,
  _booking_link text,
  _passphrase text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_secret text;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;

  -- Authorization: called from edge functions with service_role bypasses RLS,
  -- but we still want a sanity check when called by an authenticated user.
  IF v_caller IS NOT NULL THEN
    IF NOT (
      public.has_role(v_caller, 'master_admin'::app_role)
      OR (public.get_user_company_id(v_caller) = _company_id
          AND public.has_role(v_caller, 'company_admin'::app_role))
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Generate a webhook secret if not present yet
  SELECT calcom_webhook_secret INTO v_secret FROM public.companies WHERE id = _company_id;
  IF v_secret IS NULL OR v_secret = '' THEN
    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  END IF;

  UPDATE public.companies
  SET
    calcom_api_key_encrypted = extensions.pgp_sym_encrypt(_api_key, _passphrase),
    calcom_booking_link = COALESCE(NULLIF(trim(_booking_link), ''), calcom_booking_link),
    calcom_webhook_secret = v_secret,
    calcom_connected_at = now(),
    calcom_last_error = NULL,
    updated_at = now()
  WHERE id = _company_id;
END;
$$;

-- Decrypt and return the Cal.com API key. Only callable by service_role or
-- master_admin (edge functions run as service_role). Never expose to client.
CREATE OR REPLACE FUNCTION public.get_calcom_api_key(
  _company_id uuid,
  _passphrase text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_enc bytea;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  SELECT calcom_api_key_encrypted INTO v_enc FROM public.companies WHERE id = _company_id;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, _passphrase);
END;
$$;

-- Clear Cal.com credentials for a company (disconnect).
CREATE OR REPLACE FUNCTION public.clear_calcom_api_key(_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NOT (
      public.has_role(v_caller, 'master_admin'::app_role)
      OR (public.get_user_company_id(v_caller) = _company_id
          AND public.has_role(v_caller, 'company_admin'::app_role))
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;
  UPDATE public.companies
  SET calcom_api_key_encrypted = NULL,
      calcom_webhook_secret = NULL,
      calcom_connected_at = NULL,
      calcom_last_error = NULL,
      updated_at = now()
  WHERE id = _company_id;
END;
$$;

-- Regenerate webhook secret (returns the new value).
CREATE OR REPLACE FUNCTION public.regenerate_calcom_webhook_secret(_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_new text;
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NOT (
      public.has_role(v_caller, 'master_admin'::app_role)
      OR (public.get_user_company_id(v_caller) = _company_id
          AND public.has_role(v_caller, 'company_admin'::app_role))
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;
  v_new := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.companies SET calcom_webhook_secret = v_new, updated_at = now() WHERE id = _company_id;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_calcom_api_key(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_calcom_api_key(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_calcom_api_key(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regenerate_calcom_webhook_secret(uuid) TO authenticated, service_role;