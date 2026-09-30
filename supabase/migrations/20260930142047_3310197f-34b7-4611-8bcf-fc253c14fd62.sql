CREATE OR REPLACE FUNCTION public.fill_whatsapp_from_mobile()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.whatsapp IS NULL OR btrim(NEW.whatsapp) = '') AND NEW.mobile_phone IS NOT NULL AND btrim(NEW.mobile_phone) <> '' THEN
    NEW.whatsapp := NEW.mobile_phone;
    NEW.whatsapp_valid := NULL;
    NEW.whatsapp_checked_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_whatsapp_from_mobile ON public.leads;
CREATE TRIGGER trg_fill_whatsapp_from_mobile
BEFORE INSERT OR UPDATE OF mobile_phone, whatsapp ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fill_whatsapp_from_mobile();