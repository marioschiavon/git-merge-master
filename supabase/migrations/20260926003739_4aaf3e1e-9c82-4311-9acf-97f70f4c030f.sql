
REVOKE EXECUTE ON FUNCTION public.lead_protection(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_lead_protected(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protected_lead_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.block_protected_enrollment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_protect_lead_org(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_protect_on_lead_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_protect_on_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_protection(uuid), public.is_lead_protected(uuid), public.protected_lead_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.protected_lead_ids(uuid) TO authenticated;
