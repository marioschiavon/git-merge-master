
-- 1) leads: add WITH CHECK to prevent cross-tenant reassignment
DROP POLICY IF EXISTS "Members can manage their company leads" ON public.leads;
CREATE POLICY "Members can manage their company leads"
ON public.leads
FOR ALL
USING (company_id = public.get_user_company_id(auth.uid()))
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

-- 2) lead_action_queue: add WITH CHECK to admin update policy
DROP POLICY IF EXISTS action_queue_update_admin ON public.lead_action_queue;
CREATE POLICY action_queue_update_admin
ON public.lead_action_queue
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.has_role(auth.uid(), 'company_admin'::app_role)
      AND public.get_user_company_id(auth.uid()) = company_id)
)
WITH CHECK (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR (public.has_role(auth.uid(), 'company_admin'::app_role)
      AND public.get_user_company_id(auth.uid()) = company_id)
);

-- 3) lead_intents_log: fix broken insert policy to allow company-scoped inserts
DROP POLICY IF EXISTS intents_log_insert_service ON public.lead_intents_log;
CREATE POLICY intents_log_insert_service
ON public.lead_intents_log
FOR INSERT
WITH CHECK (
  auth.role() = 'service_role'
  OR public.has_role(auth.uid(), 'master_admin'::app_role)
  OR public.get_user_company_id(auth.uid()) = company_id
);

-- 4) calcom_webhook_log: add explicit service-role-only write policies with WITH CHECK
CREATE POLICY calcom_webhook_log_insert_service
ON public.calcom_webhook_log
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY calcom_webhook_log_update_service
ON public.calcom_webhook_log
FOR UPDATE
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY calcom_webhook_log_delete_service
ON public.calcom_webhook_log
FOR DELETE
USING (auth.role() = 'service_role');

-- 5) Fix mutable search_path on email queue helper functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 6) Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that
--    should only be invoked by the backend (service_role) or by triggers.
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.get_hook7_instance_token(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_hook7_instance_token(uuid, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enqueue_lead_enrichment() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.after_enrichment_done() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- Keep RLS helper functions and client-callable RPCs executable where needed
-- (has_role, get_user_company_id are needed by RLS policy evaluation;
--  create_company_and_join and delete_lead_cascade are called from the app).
REVOKE EXECUTE ON FUNCTION public.create_company_and_join(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_lead_cascade(uuid) FROM anon, public;
