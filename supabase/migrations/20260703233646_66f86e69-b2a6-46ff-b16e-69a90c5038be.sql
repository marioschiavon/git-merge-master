-- Add OAuth token columns to gmail_account (per-company Gmail OAuth)
ALTER TABLE public.gmail_account
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted bytea,
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS google_user_id text,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

-- One active Gmail account per company
DROP INDEX IF EXISTS gmail_account_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS gmail_account_company_active_unique
  ON public.gmail_account(company_id) WHERE is_active;

-- RPC: set OAuth tokens for a company (called from edge functions)
CREATE OR REPLACE FUNCTION public.set_gmail_oauth_tokens(
  _company_id uuid,
  _email text,
  _refresh_token text,
  _access_token text,
  _access_token_expires_at timestamptz,
  _scope text,
  _google_user_id text,
  _passphrase text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_id uuid;
  v_enc bytea;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  v_enc := extensions.pgp_sym_encrypt(_refresh_token, _passphrase);

  -- Deactivate any existing active accounts for this company
  UPDATE public.gmail_account SET is_active = false
    WHERE company_id = _company_id AND is_active = true AND email <> _email;

  INSERT INTO public.gmail_account (
    company_id, email, is_active, refresh_token_encrypted,
    access_token, access_token_expires_at, scope, google_user_id,
    connected_at, last_error
  ) VALUES (
    _company_id, _email, true, v_enc,
    _access_token, _access_token_expires_at, _scope, _google_user_id,
    now(), NULL
  )
  ON CONFLICT (company_id) WHERE is_active
  DO UPDATE SET
    email = EXCLUDED.email,
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    access_token = EXCLUDED.access_token,
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    scope = EXCLUDED.scope,
    google_user_id = EXCLUDED.google_user_id,
    connected_at = now(),
    last_error = NULL,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- RPC: get decrypted refresh_token + current access_token for a company
CREATE OR REPLACE FUNCTION public.get_gmail_oauth_tokens(
  _company_id uuid,
  _passphrase text
) RETURNS TABLE (
  email text,
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  scope text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  RETURN QUERY
  SELECT
    a.email,
    extensions.pgp_sym_decrypt(a.refresh_token_encrypted, _passphrase),
    a.access_token,
    a.access_token_expires_at,
    a.scope
  FROM public.gmail_account a
  WHERE a.company_id = _company_id AND a.is_active = true
  LIMIT 1;
END;
$$;

-- RPC: update just the access_token after a refresh
CREATE OR REPLACE FUNCTION public.update_gmail_access_token(
  _company_id uuid,
  _access_token text,
  _access_token_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.gmail_account
  SET access_token = _access_token,
      access_token_expires_at = _access_token_expires_at,
      last_error = NULL,
      updated_at = now()
  WHERE company_id = _company_id AND is_active = true;
END;
$$;

-- RPC: record an auth error (e.g. refresh failed)
CREATE OR REPLACE FUNCTION public.mark_gmail_error(
  _company_id uuid,
  _error text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.gmail_account
  SET last_error = _error, updated_at = now()
  WHERE company_id = _company_id AND is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_gmail_oauth_tokens(uuid,text,text,text,timestamptz,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.get_gmail_oauth_tokens(uuid,text) FROM public;
REVOKE ALL ON FUNCTION public.update_gmail_access_token(uuid,text,timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.mark_gmail_error(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_gmail_oauth_tokens(uuid,text,text,text,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_gmail_oauth_tokens(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_gmail_access_token(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_gmail_error(uuid,text) TO service_role;