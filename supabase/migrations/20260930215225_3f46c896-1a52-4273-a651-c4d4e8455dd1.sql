CREATE OR REPLACE FUNCTION public.block_protected_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.lead_protection(NEW.lead_id);
  IF FOUND THEN
    INSERT INTO public.lead_activities (company_id, lead_id, type, description)
    SELECT l.company_id, l.id, 'note', 'Não entrou na cadência: organização protegida (' || coalesce(p.label,'') || ')'
    FROM public.leads l WHERE l.id = NEW.lead_id;
    RETURN NULL; -- pula só esta linha; o restante do lote segue
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.requeue_bitrix_skipped_stages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.provider::text <> 'bitrix24' THEN RETURN NEW; END IF;
  IF coalesce(NEW.config->>'stage_replied','') <> '' AND coalesce(OLD.config->>'stage_replied','') = '' THEN
    UPDATE public.bitrix_sync_queue SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL
    WHERE company_id=NEW.company_id AND event='stage_replied' AND status='skipped'
      AND last_error LIKE 'Etapa não configurada%';
  END IF;
  IF coalesce(NEW.config->>'stage_meeting','') <> '' AND coalesce(OLD.config->>'stage_meeting','') = '' THEN
    UPDATE public.bitrix_sync_queue SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL
    WHERE company_id=NEW.company_id AND event='stage_meeting' AND status='skipped'
      AND last_error LIKE 'Etapa não configurada%';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS requeue_bitrix_skipped_stages_trg ON public.integrations;
CREATE TRIGGER requeue_bitrix_skipped_stages_trg AFTER UPDATE OF config ON public.integrations
FOR EACH ROW EXECUTE FUNCTION public.requeue_bitrix_skipped_stages();