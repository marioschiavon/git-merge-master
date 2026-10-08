ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS social_enrichment jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.guard_social_enrichment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.social_enrichment IS DISTINCT FROM OLD.social_enrichment
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'master_admin') THEN
    RAISE EXCEPTION 'Somente o master pode alterar o enriquecimento de redes';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_social_enrichment ON public.companies;
CREATE TRIGGER trg_guard_social_enrichment BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.guard_social_enrichment();

UPDATE public.platform_settings SET apify_actors = jsonb_build_object(
  'instagram', jsonb_build_object('enabled', true, 'actor_id', 'apify/instagram-scraper'),
  'facebook', jsonb_build_object('enabled', true, 'actor_id', 'apify/facebook-pages-scraper'),
  'linkedin_person', jsonb_build_object('enabled', true, 'actor_id', 'harvestapi/linkedin-profile-scraper'),
  'linkedin_company', jsonb_build_object('enabled', true, 'actor_id', 'harvestapi/linkedin-company')
);