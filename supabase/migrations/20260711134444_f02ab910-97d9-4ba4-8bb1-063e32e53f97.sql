CREATE POLICY "Company admins can update their company"
ON public.companies
FOR UPDATE
TO authenticated
USING (
  id = public.get_user_company_id(auth.uid())
  AND public.has_role(auth.uid(), 'company_admin'::app_role)
)
WITH CHECK (
  id = public.get_user_company_id(auth.uid())
  AND public.has_role(auth.uid(), 'company_admin'::app_role)
);