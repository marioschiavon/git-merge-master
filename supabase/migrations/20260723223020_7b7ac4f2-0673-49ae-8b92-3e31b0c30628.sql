DROP POLICY IF EXISTS "Company members can view approvals" ON public.approval_requests;
DROP POLICY IF EXISTS "Company members can insert approvals" ON public.approval_requests;
DROP POLICY IF EXISTS "Company members can update approvals" ON public.approval_requests;
DROP POLICY IF EXISTS "Company members can delete approvals" ON public.approval_requests;

CREATE POLICY "Company members can view approvals" ON public.approval_requests
  FOR SELECT USING (public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "Company members can insert approvals" ON public.approval_requests
  FOR INSERT WITH CHECK (public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "Company members can update approvals" ON public.approval_requests
  FOR UPDATE USING (public.get_user_company_id(auth.uid()) = company_id)
  WITH CHECK (public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "Company members can delete approvals" ON public.approval_requests
  FOR DELETE USING (public.get_user_company_id(auth.uid()) = company_id);