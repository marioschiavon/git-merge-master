
-- 1) gmail_account: scope to company
ALTER TABLE public.gmail_account
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS gmail_account_company_id_idx ON public.gmail_account(company_id);

DROP POLICY IF EXISTS "Authenticated can view gmail account" ON public.gmail_account;
DROP POLICY IF EXISTS "gmail_account_tenant_select" ON public.gmail_account;
DROP POLICY IF EXISTS "gmail_account_tenant_write" ON public.gmail_account;
DROP POLICY IF EXISTS "gmail_account_service_role" ON public.gmail_account;

ALTER TABLE public.gmail_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gmail_account_tenant_select" ON public.gmail_account
  FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND (
    company_id = public.get_user_company_id(auth.uid())
    OR public.has_role(auth.uid(),'master_admin')
  ));

CREATE POLICY "gmail_account_tenant_write" ON public.gmail_account
  FOR ALL TO authenticated
  USING (company_id IS NOT NULL AND (
    company_id = public.get_user_company_id(auth.uid())
    OR public.has_role(auth.uid(),'master_admin')
  ))
  WITH CHECK (company_id IS NOT NULL AND (
    company_id = public.get_user_company_id(auth.uid())
    OR public.has_role(auth.uid(),'master_admin')
  ));

CREATE POLICY "gmail_account_service_role" ON public.gmail_account
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_account TO authenticated;
GRANT ALL ON public.gmail_account TO service_role;

-- 2) profiles: only see profiles of members from same company (+ self)
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users view profiles in own company" ON public.profiles;

CREATE POLICY "Users view profiles in own company" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'master_admin')
    OR EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.user_id = public.profiles.user_id
        AND cm.company_id = public.get_user_company_id(auth.uid())
    )
  );
