CREATE OR REPLACE FUNCTION public.mark_lead_enrolled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET status = 'enrolled'
  WHERE id = NEW.lead_id
    AND status = 'new';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_lead_enrolled ON public.cadence_enrollments;
CREATE TRIGGER trg_mark_lead_enrolled
AFTER INSERT ON public.cadence_enrollments
FOR EACH ROW EXECUTE FUNCTION public.mark_lead_enrolled();

UPDATE public.leads l
SET status = 'enrolled'
WHERE l.status = 'new'
  AND EXISTS (SELECT 1 FROM public.cadence_enrollments e WHERE e.lead_id = l.id);