
CREATE OR REPLACE FUNCTION public.norm_org_text(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(btrim(regexp_replace(lower(translate(coalesce(_t,''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.org_domain(_website text, _email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text;
BEGIN
  IF _website IS NOT NULL AND btrim(_website) <> '' THEN
    d := lower(regexp_replace(regexp_replace(btrim(_website), '^[a-z]+://', '', 'i'), '[/?#:].*$', ''));
    d := regexp_replace(d, '^www\.', '');
    IF d <> '' THEN RETURN d; END IF;
  END IF;
  IF _email IS NOT NULL AND position('@' in _email) > 0 THEN
    d := lower(split_part(btrim(_email), '@', 2));
    IF d = ANY (ARRAY['gmail.com','hotmail.com','outlook.com','yahoo.com','yahoo.com.br','live.com','icloud.com','bol.com.br','uol.com.br','terra.com.br','ig.com.br','msn.com','hotmail.com.br','outlook.com.br']) THEN
      RETURN NULL;
    END IF;
    RETURN NULLIF(d, '');
  END IF;
  RETURN NULL;
END $$;

CREATE TABLE public.protected_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'municipio',
  label text NOT NULL,
  city text,
  state text,
  domain text,
  name_normalized text,
  reason text NOT NULL DEFAULT 'cliente',
  note text,
  source text NOT NULL DEFAULT 'manual',
  lead_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX protected_orgs_muni_uq ON public.protected_organizations (company_id, (public.norm_org_text(city)), upper(state)) WHERE kind = 'municipio';
CREATE UNIQUE INDEX protected_orgs_domain_uq ON public.protected_organizations (company_id, domain) WHERE kind = 'empresa' AND domain IS NOT NULL;
CREATE UNIQUE INDEX protected_orgs_name_uq ON public.protected_organizations (company_id, name_normalized) WHERE kind = 'empresa' AND domain IS NULL AND name_normalized IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.protected_organizations TO authenticated;
GRANT ALL ON public.protected_organizations TO service_role;
ALTER TABLE public.protected_organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members manage protected orgs" ON public.protected_organizations
  FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(), 'master_admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(), 'master_admin'));

CREATE OR REPLACE FUNCTION public.protected_orgs_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind NOT IN ('municipio','empresa') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF NEW.reason NOT IN ('cliente','em_negociacao','nao_contatar','outro') THEN NEW.reason := 'outro'; END IF;
  NEW.state := NULLIF(upper(btrim(coalesce(NEW.state,''))), '');
  IF NEW.kind = 'municipio' AND (NEW.city IS NULL OR NEW.state IS NULL) THEN
    RAISE EXCEPTION 'Informe município e UF';
  END IF;
  IF NEW.kind = 'empresa' THEN
    NEW.domain := public.org_domain(NEW.domain, NULL);
    NEW.name_normalized := public.norm_org_text(coalesce(NEW.name_normalized, NEW.label));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER protected_orgs_normalize_trg BEFORE INSERT OR UPDATE ON public.protected_organizations
  FOR EACH ROW EXECUTE FUNCTION public.protected_orgs_normalize();

-- Retorna o registro de proteção que se aplica ao lead (ou nada)
CREATE OR REPLACE FUNCTION public.lead_protection(_lead_id uuid)
RETURNS TABLE(id uuid, label text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.label, p.reason
  FROM public.leads l
  JOIN public.protected_organizations p ON p.company_id = l.company_id
  WHERE l.id = _lead_id AND (
    (p.kind = 'municipio' AND public.norm_org_text(l.city) = public.norm_org_text(p.city) AND upper(coalesce(l.state,'')) = p.state)
    OR (p.kind = 'empresa' AND p.domain IS NOT NULL AND p.domain = public.org_domain(l.website, l.email))
    OR (p.kind = 'empresa' AND p.name_normalized IS NOT NULL AND p.name_normalized = public.norm_org_text(l.company_name))
  )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_lead_protected(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.lead_protection(_lead_id))
$$;

-- Lista de leads protegidos da empresa (para o selo na tela)
CREATE OR REPLACE FUNCTION public.protected_lead_ids(_company_id uuid)
RETURNS TABLE(lead_id uuid, label text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, p.label, p.reason
  FROM public.leads l
  JOIN public.protected_organizations p ON p.company_id = l.company_id
  WHERE l.company_id = _company_id
    AND (_company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin') OR auth.role() = 'service_role')
    AND (
      (p.kind = 'municipio' AND public.norm_org_text(l.city) = public.norm_org_text(p.city) AND upper(coalesce(l.state,'')) = p.state)
      OR (p.kind = 'empresa' AND p.domain IS NOT NULL AND p.domain = public.org_domain(l.website, l.email))
      OR (p.kind = 'empresa' AND p.name_normalized IS NOT NULL AND p.name_normalized = public.norm_org_text(l.company_name))
    )
$$;

-- Bloqueia inclusão em cadência
CREATE OR REPLACE FUNCTION public.block_protected_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.lead_protection(NEW.lead_id);
  IF FOUND THEN
    RAISE EXCEPTION 'Organização protegida (%): este lead não pode entrar em cadência', p.label
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block_protected_enrollment_trg BEFORE INSERT ON public.cadence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.block_protected_enrollment();

-- Proteção automática
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS auto_protect_orgs boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.auto_protect_lead_org(_lead_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; d text; enabled boolean;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT auto_protect_orgs INTO enabled FROM public.companies WHERE id = l.company_id;
  IF NOT coalesce(enabled, true) THEN RETURN; END IF;
  IF public.is_lead_protected(_lead_id) THEN RETURN; END IF;

  IF l.city IS NOT NULL AND l.state IS NOT NULL AND (l.source = 'municipia' OR l.company_name ILIKE 'prefeitura%' OR l.company_name ILIKE 'c_mara%') THEN
    INSERT INTO public.protected_organizations(company_id, kind, label, city, state, reason, source, lead_id, note)
    VALUES (l.company_id, 'municipio', l.city || ' / ' || upper(l.state), l.city, l.state, _reason, 'auto', l.id, 'Protegido automaticamente a partir de ' || coalesce(l.name,'lead'))
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  d := public.org_domain(l.website, l.email);
  IF d IS NULL AND public.norm_org_text(l.company_name) IS NULL THEN RETURN; END IF;
  INSERT INTO public.protected_organizations(company_id, kind, label, domain, name_normalized, reason, source, lead_id, note)
  VALUES (l.company_id, 'empresa', coalesce(l.company_name, d), d, public.norm_org_text(l.company_name), _reason, 'auto', l.id, 'Protegido automaticamente a partir de ' || coalesce(l.name,'lead'))
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN others THEN
  RETURN;
END $$;

CREATE OR REPLACE FUNCTION public.auto_protect_on_lead_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted' THEN
    PERFORM public.auto_protect_lead_org(NEW.id, 'cliente');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auto_protect_on_lead_status_trg AFTER UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.auto_protect_on_lead_status();

CREATE OR REPLACE FUNCTION public.auto_protect_on_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.status IN ('confirmed','rescheduled','completed') THEN
    PERFORM public.auto_protect_lead_org(NEW.lead_id, 'em_negociacao');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auto_protect_on_booking_trg AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.auto_protect_on_booking();
