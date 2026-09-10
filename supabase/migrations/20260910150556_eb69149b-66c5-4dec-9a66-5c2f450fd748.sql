CREATE OR REPLACE FUNCTION public.normalize_phone_br(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
  local text;
  ddd text;
  rest text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN NULL; END IF;
  d := regexp_replace(_raw, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;

  IF left(d,2) = '55' AND length(d) IN (12,13) THEN
    local := substr(d,3);
  ELSIF length(d) IN (10,11) THEN
    local := d;
  ELSIF length(d) IN (11,12) AND left(d,1) = '0' THEN
    local := substr(d,2);
  ELSE
    local := NULL;
  END IF;

  IF local IS NOT NULL AND length(local) IN (10,11) THEN
    ddd := left(local,2);
    rest := substr(local,3);
    IF length(rest) = 8 AND rest ~ '^[6-9]' THEN rest := '9' || rest; END IF;
    IF length(rest) = 9 AND rest !~ '^9' THEN RETURN _raw; END IF;
    RETURN '+55' || ddd || rest;
  END IF;

  IF length(d) BETWEEN 8 AND 15 THEN RETURN '+' || d; END IF;
  RETURN _raw;
END;
$$;