
CREATE OR REPLACE FUNCTION public.set_hook7_instance_token(_instance_id uuid, _token text, _passphrase text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF _passphrase IS NULL OR length(_passphrase) < 16 THEN
    RAISE EXCEPTION 'passphrase required';
  END IF;
  UPDATE public.hook7_instances
  SET token_encrypted = extensions.pgp_sym_encrypt(_token, _passphrase),
      updated_at = now()
  WHERE id = _instance_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_hook7_instance_token(_instance_id uuid, _passphrase text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_token text; v_enc bytea;
BEGIN
  SELECT token_encrypted INTO v_enc FROM public.hook7_instances WHERE id = _instance_id;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  v_token := extensions.pgp_sym_decrypt(v_enc, _passphrase);
  RETURN v_token;
END;
$function$;
