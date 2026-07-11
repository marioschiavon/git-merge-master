
CREATE OR REPLACE FUNCTION public.mark_lead_for_reenrichment_on_url_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.instagram_url IS DISTINCT FROM OLD.instagram_url)
     OR (NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url)
     OR (NEW.linkedin_company_url IS DISTINCT FROM OLD.linkedin_company_url)
     OR (NEW.facebook_url IS DISTINCT FROM OLD.facebook_url) THEN
    NEW.enrichment_status := 'pending';
    NEW.enrichment_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_reenrich_on_url_change ON public.leads;
CREATE TRIGGER trg_leads_reenrich_on_url_change
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.mark_lead_for_reenrichment_on_url_change();
