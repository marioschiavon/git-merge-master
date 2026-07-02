
CREATE OR REPLACE FUNCTION public.create_company_and_join(p_name text, p_slug text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company_id uuid;
  v_slug text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'User already belongs to a company';
  END IF;

  v_slug := COALESCE(NULLIF(trim(p_slug), ''), lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN v_slug := 'company-' || substr(gen_random_uuid()::text, 1, 8); END IF;

  -- ensure slug uniqueness
  WHILE EXISTS (SELECT 1 FROM public.companies WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.companies (name, slug, status)
  VALUES (trim(p_name), v_slug, 'active')
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (v_user, v_company_id, 'company_admin');

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user, 'company_admin')
  ON CONFLICT DO NOTHING;

  RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_company_and_join(text, text) TO authenticated;
