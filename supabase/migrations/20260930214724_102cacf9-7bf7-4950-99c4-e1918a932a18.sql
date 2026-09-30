CREATE OR REPLACE FUNCTION public.normalize_phone_br_single(_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d text; local text; ddd text; rest text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN NULL; END IF;
  d := regexp_replace(_raw, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF left(d,2) = '55' AND length(d) IN (12,13) THEN local := substr(d,3);
  ELSIF length(d) IN (10,11) THEN local := d;
  ELSIF length(d) = 12 AND left(d,1) = '0' THEN local := substr(d,2);
  ELSE local := NULL; END IF;
  IF local IS NOT NULL AND length(local) IN (10,11) THEN
    ddd := left(local,2); rest := substr(local,3);
    IF length(rest) = 8 AND rest ~ '^[6-9]' THEN rest := '9' || rest; END IF;
    IF length(rest) = 9 AND rest !~ '^9' THEN RETURN NULL; END IF;
    RETURN '+55' || ddd || rest;
  END IF;
  IF length(d) BETWEEN 8 AND 15 THEN RETURN '+' || d; END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_phone_br(_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE parts text[]; p text; n text; first_ok text; single text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN NULL; END IF;
  IF _raw !~ '[,;/|\n]' THEN
    single := public.normalize_phone_br_single(_raw);
    RETURN COALESCE(single, _raw);
  END IF;
  parts := regexp_split_to_array(_raw, '[,;/|\n]+');
  FOREACH p IN ARRAY parts LOOP
    n := public.normalize_phone_br_single(p);
    IF n IS NULL THEN CONTINUE; END IF;
    IF n ~ '^\+55\d{2}9\d{8}$' THEN RETURN n; END IF;
    IF first_ok IS NULL THEN first_ok := n; END IF;
  END LOOP;
  RETURN COALESCE(first_ok, _raw);
END; $$;