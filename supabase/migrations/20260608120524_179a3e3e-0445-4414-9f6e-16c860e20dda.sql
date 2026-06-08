CREATE OR REPLACE FUNCTION public.delete_lead_cascade(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.leads WHERE id = p_lead_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = v_company_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.messages
    WHERE conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = p_lead_id);
  DELETE FROM public.conversations WHERE lead_id = p_lead_id;
  DELETE FROM public.cadence_custom_messages WHERE lead_id = p_lead_id;
  DELETE FROM public.cadence_enrollments WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_insights WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_activities WHERE lead_id = p_lead_id;
  DELETE FROM public.execution_logs WHERE lead_id = p_lead_id;
  DELETE FROM public.slot_holds WHERE lead_id = p_lead_id;
  DELETE FROM public.leads WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_lead_cascade(uuid) TO authenticated;