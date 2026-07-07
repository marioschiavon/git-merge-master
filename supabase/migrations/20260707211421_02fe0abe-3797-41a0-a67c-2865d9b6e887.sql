
-- P0: Score configurável por cliente + coluna numérica + controle de volume no enriquecimento

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS scoring_prompt text,
  ADD COLUMN IF NOT EXISTS scoring_include text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS scoring_exclude text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.lead_insights
  ADD COLUMN IF NOT EXISTS score integer,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

-- Trigger passa a respeitar leads marcados como 'not_queued' (ficam de fora do enriquecimento automático)
CREATE OR REPLACE FUNCTION public.enqueue_lead_enrichment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s jsonb;
BEGIN
  IF NEW.enrichment_status = 'not_queued' THEN
    RETURN NEW;
  END IF;
  SELECT enrichment_settings INTO s FROM public.companies WHERE id = NEW.company_id;
  IF s IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((s->>'website_analysis')::bool,false) OR COALESCE((s->>'discover_socials')::bool,false)
     OR COALESCE((s->>'apify_scrape')::bool,false) OR COALESCE((s->>'generate_message')::bool,false) THEN
    INSERT INTO public.lead_enrichment_jobs (lead_id, company_id) VALUES (NEW.id, NEW.company_id)
    ON CONFLICT (lead_id) WHERE status IN ('pending','processing') DO NOTHING;
    UPDATE public.leads SET enrichment_status='pending', enrichment_updated_at=now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $function$;
