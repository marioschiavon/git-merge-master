DROP POLICY IF EXISTS "Members can manage their company leads" ON public.leads;
CREATE POLICY "Members can manage their company leads" ON public.leads
FOR ALL TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()))
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));