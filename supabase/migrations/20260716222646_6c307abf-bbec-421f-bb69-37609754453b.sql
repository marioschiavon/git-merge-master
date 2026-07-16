
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS elevenlabs_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS elevenlabs_last_error text,
  ADD COLUMN IF NOT EXISTS elevenlabs_model text NOT NULL DEFAULT 'scribe_v2';

CREATE OR REPLACE FUNCTION public.set_elevenlabs_master_key(_api_key text, _passphrase text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  IF _api_key IS NULL OR length(trim(_api_key)) < 8 THEN
    RAISE EXCEPTION 'api_key required';
  END IF;
  IF v_caller IS NOT NULL THEN
    IF NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;
  UPDATE public.platform_settings
    SET elevenlabs_api_key_encrypted = extensions.pgp_sym_encrypt(_api_key, _passphrase),
        elevenlabs_connected_at = now(),
        elevenlabs_last_error = NULL,
        updated_at = now()
    WHERE singleton = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_elevenlabs_master_key(_passphrase text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_enc bytea;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  SELECT elevenlabs_api_key_encrypted INTO v_enc
    FROM public.platform_settings
    WHERE singleton = true;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, _passphrase);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_elevenlabs_master_key()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;
  UPDATE public.platform_settings
    SET elevenlabs_api_key_encrypted = NULL,
        elevenlabs_connected_at = NULL,
        elevenlabs_last_error = NULL,
        updated_at = now()
    WHERE singleton = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_elevenlabs_master_model(_model text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;
  IF _model NOT IN ('scribe_v2', 'scribe_v2_realtime') THEN
    RAISE EXCEPTION 'invalid model';
  END IF;
  UPDATE public.platform_settings
    SET elevenlabs_model = _model,
        updated_at = now()
    WHERE singleton = true;
END;
$$;
