
-- Table
CREATE TABLE public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_invites_company ON public.company_invites(company_id);
CREATE INDEX idx_company_invites_token ON public.company_invites(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invites TO authenticated;
GRANT ALL ON public.company_invites TO service_role;

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view company invites"
ON public.company_invites FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(), 'company_admin'::app_role))
);

CREATE POLICY "Admins can insert company invites"
ON public.company_invites FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(), 'company_admin'::app_role))
);

CREATE POLICY "Admins can update company invites"
ON public.company_invites FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(), 'company_admin'::app_role))
);

CREATE POLICY "Admins can delete company invites"
ON public.company_invites FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.get_user_company_id(auth.uid()) = company_id AND public.has_role(auth.uid(), 'company_admin'::app_role))
);

CREATE TRIGGER update_company_invites_updated_at
BEFORE UPDATE ON public.company_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: get_invite_by_token (public - anon can call)
CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token text)
RETURNS TABLE(company_id uuid, company_name text, role app_role, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invites;
  v_status text;
  v_name text;
BEGIN
  SELECT * INTO v_inv FROM public.company_invites WHERE token = _token;
  IF v_inv.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::app_role, 'not_found'::text;
    RETURN;
  END IF;
  IF v_inv.cancelled_at IS NOT NULL THEN
    v_status := 'cancelled';
  ELSIF v_inv.accepted_at IS NOT NULL THEN
    v_status := 'accepted';
  ELSIF v_inv.expires_at < now() THEN
    v_status := 'expired';
  ELSE
    v_status := 'pending';
  END IF;
  SELECT name INTO v_name FROM public.companies WHERE id = v_inv.company_id;
  RETURN QUERY SELECT v_inv.company_id, v_name, v_inv.role, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;

-- RPC: create_company_invite
CREATE OR REPLACE FUNCTION public.create_company_invite(_role app_role)
RETURNS TABLE(id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_company_id uuid;
  v_new public.company_invites;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _role NOT IN ('company_admin','user') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  v_company_id := public.get_user_company_id(v_caller);
  IF v_company_id IS NULL AND NOT public.has_role(v_caller, 'master_admin'::app_role) THEN
    RAISE EXCEPTION 'Not in a company';
  END IF;

  IF NOT (
    public.has_role(v_caller, 'master_admin'::app_role)
    OR public.has_role(v_caller, 'company_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.company_invites (company_id, role, invited_by)
  VALUES (v_company_id, _role, v_caller)
  RETURNING * INTO v_new;

  RETURN QUERY SELECT v_new.id, v_new.token, v_new.expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_company_invite(app_role) TO authenticated;

-- RPC: cancel_company_invite
CREATE OR REPLACE FUNCTION public.cancel_company_invite(_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_company_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT company_id INTO v_company_id FROM public.company_invites WHERE id = _invite_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF NOT (
    public.has_role(v_caller, 'master_admin'::app_role)
    OR (public.get_user_company_id(v_caller) = v_company_id AND public.has_role(v_caller, 'company_admin'::app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.company_invites SET cancelled_at = now() WHERE id = _invite_id AND cancelled_at IS NULL AND accepted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_company_invite(uuid) TO authenticated;

-- RPC: accept_company_invite
CREATE OR REPLACE FUNCTION public.accept_company_invite(_token text, _user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invites;
BEGIN
  SELECT * INTO v_inv FROM public.company_invites WHERE token = _token;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado';
  END IF;
  IF v_inv.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Convite cancelado';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Convite já utilizado';
  END IF;
  IF v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'Convite expirado';
  END IF;

  -- Prevent joining if user already in a company
  IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'Usuário já pertence a uma empresa';
  END IF;

  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (_user_id, v_inv.company_id, v_inv.role);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, v_inv.role)
  ON CONFLICT DO NOTHING;

  UPDATE public.company_invites
  SET accepted_at = now(), accepted_by = _user_id
  WHERE id = v_inv.id;

  RETURN v_inv.company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_company_invite(text, uuid) TO anon, authenticated;
