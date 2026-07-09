
-- List members with email/profile info
CREATE OR REPLACE FUNCTION public.list_company_members(_company_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  role app_role,
  joined_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cm.user_id,
    u.email::text,
    p.full_name,
    p.phone,
    cm.role,
    cm.created_at AS joined_at
  FROM public.company_members cm
  LEFT JOIN public.profiles p ON p.user_id = cm.user_id
  LEFT JOIN auth.users u ON u.id = cm.user_id
  WHERE cm.company_id = _company_id
    AND (
      public.has_role(auth.uid(), 'master_admin'::app_role)
      OR public.get_user_company_id(auth.uid()) = _company_id
    )
  ORDER BY cm.created_at ASC;
$$;

-- Update member role
CREATE OR REPLACE FUNCTION public.update_company_member_role(_user_id uuid, _new_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_company uuid;
  v_old_role app_role;
  v_admin_count int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _new_role NOT IN ('company_admin','user') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT company_id, role INTO v_target_company, v_old_role
  FROM public.company_members WHERE user_id = _user_id;
  IF v_target_company IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF NOT (
    public.has_role(v_caller, 'master_admin'::app_role)
    OR (public.get_user_company_id(v_caller) = v_target_company AND public.has_role(v_caller, 'company_admin'::app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_old_role = 'master_admin' THEN
    RAISE EXCEPTION 'Cannot change master_admin role';
  END IF;

  IF v_old_role = _new_role THEN
    RETURN;
  END IF;

  -- prevent removing last company_admin
  IF v_old_role = 'company_admin' AND _new_role <> 'company_admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.company_members
    WHERE company_id = v_target_company AND role = 'company_admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'A empresa precisa ter pelo menos um admin';
    END IF;
  END IF;

  UPDATE public.company_members SET role = _new_role WHERE user_id = _user_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = v_old_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _new_role)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Remove member
CREATE OR REPLACE FUNCTION public.remove_company_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_company uuid;
  v_target_role app_role;
  v_admin_count int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_caller = _user_id THEN
    RAISE EXCEPTION 'Você não pode remover a si mesmo';
  END IF;

  SELECT company_id, role INTO v_target_company, v_target_role
  FROM public.company_members WHERE user_id = _user_id;
  IF v_target_company IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF NOT (
    public.has_role(v_caller, 'master_admin'::app_role)
    OR (public.get_user_company_id(v_caller) = v_target_company AND public.has_role(v_caller, 'company_admin'::app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_target_role = 'master_admin' THEN
    RAISE EXCEPTION 'Cannot remove master_admin';
  END IF;

  IF v_target_role = 'company_admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.company_members
    WHERE company_id = v_target_company AND role = 'company_admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'A empresa precisa ter pelo menos um admin';
    END IF;
  END IF;

  DELETE FROM public.company_members WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = v_target_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_company_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_member_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_company_member(uuid) TO authenticated;
