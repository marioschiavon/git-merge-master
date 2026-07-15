
-- 2. cadence_policies: split ALL policy into granular ones
DROP POLICY IF EXISTS "Members manage own company policies" ON public.cadence_policies;
CREATE POLICY "cadence_policies_select" ON public.cadence_policies FOR SELECT
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'::app_role));
CREATE POLICY "cadence_policies_insert" ON public.cadence_policies FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'::app_role));
CREATE POLICY "cadence_policies_update" ON public.cadence_policies FOR UPDATE
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'::app_role))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'::app_role));
CREATE POLICY "cadence_policies_delete" ON public.cadence_policies FOR DELETE
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'::app_role));

-- 3. Revoke EXECUTE on sensitive SECURITY DEFINER functions from PUBLIC/anon/authenticated.
-- service_role retains access via GRANT ALL default on functions owned by postgres.
REVOKE EXECUTE ON FUNCTION public.get_calcom_api_key(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_calcom_api_key(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_calcom_api_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.regenerate_calcom_webhook_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_resend_master_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_resend_master_key(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_resend_master_key() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_hook7_instance_token(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_hook7_instance_token(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text,text,bigint,jsonb) FROM PUBLIC, anon, authenticated;

-- 5. company_members: only SELECT via RLS; writes only through SECURITY DEFINER RPCs (service_role)
DROP POLICY IF EXISTS "Company admins can manage their company members" ON public.company_members;
DROP POLICY IF EXISTS "Master admins can manage all members" ON public.company_members;
CREATE POLICY "Master admins can view all members" ON public.company_members FOR SELECT
  USING (public.has_role(auth.uid(),'master_admin'::app_role));
