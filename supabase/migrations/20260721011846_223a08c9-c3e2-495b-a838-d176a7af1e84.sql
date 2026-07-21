
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS openai_api_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS openai_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS openai_last_error text,
  ADD COLUMN IF NOT EXISTS gemini_api_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS gemini_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS gemini_last_error text;

-- OpenAI
CREATE OR REPLACE FUNCTION public.set_openai_master_key(_api_key text, _passphrase text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN RAISE EXCEPTION 'passphrase required'; END IF;
  IF _api_key IS NULL OR length(trim(_api_key)) < 8 THEN RAISE EXCEPTION 'api_key required'; END IF;
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.platform_settings
    SET openai_api_key_encrypted = extensions.pgp_sym_encrypt(_api_key, _passphrase),
        openai_connected_at = now(),
        openai_last_error = NULL,
        updated_at = now()
    WHERE singleton = true;
END; $$;

CREATE OR REPLACE FUNCTION public.get_openai_master_key(_passphrase text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_enc bytea;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN RAISE EXCEPTION 'passphrase required'; END IF;
  SELECT openai_api_key_encrypted INTO v_enc FROM public.platform_settings WHERE singleton = true;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, _passphrase);
END; $$;

CREATE OR REPLACE FUNCTION public.clear_openai_master_key()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.platform_settings
    SET openai_api_key_encrypted = NULL, openai_connected_at = NULL, openai_last_error = NULL, updated_at = now()
    WHERE singleton = true;
END; $$;

-- Gemini
CREATE OR REPLACE FUNCTION public.set_gemini_master_key(_api_key text, _passphrase text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN RAISE EXCEPTION 'passphrase required'; END IF;
  IF _api_key IS NULL OR length(trim(_api_key)) < 8 THEN RAISE EXCEPTION 'api_key required'; END IF;
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.platform_settings
    SET gemini_api_key_encrypted = extensions.pgp_sym_encrypt(_api_key, _passphrase),
        gemini_connected_at = now(),
        gemini_last_error = NULL,
        updated_at = now()
    WHERE singleton = true;
END; $$;

CREATE OR REPLACE FUNCTION public.get_gemini_master_key(_passphrase text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_enc bytea;
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN RAISE EXCEPTION 'passphrase required'; END IF;
  SELECT gemini_api_key_encrypted INTO v_enc FROM public.platform_settings WHERE singleton = true;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, _passphrase);
END; $$;

CREATE OR REPLACE FUNCTION public.clear_gemini_master_key()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.platform_settings
    SET gemini_api_key_encrypted = NULL, gemini_connected_at = NULL, gemini_last_error = NULL, updated_at = now()
    WHERE singleton = true;
END; $$;

-- Restrict function execution to server-side callers only
REVOKE EXECUTE ON FUNCTION public.set_openai_master_key(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_openai_master_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_openai_master_key() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gemini_master_key(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_gemini_master_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_gemini_master_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_openai_master_key(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_openai_master_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_openai_master_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_gemini_master_key(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_gemini_master_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_gemini_master_key() TO service_role;
