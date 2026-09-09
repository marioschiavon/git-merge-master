ALTER TABLE public.bitrix_sync_queue DROP CONSTRAINT IF EXISTS bitrix_sync_queue_event_check;
ALTER TABLE public.bitrix_sync_queue ADD CONSTRAINT bitrix_sync_queue_event_check
  CHECK (event IN ('create_deal','move_stage','stage_replied','stage_meeting'));

ALTER TABLE public.bitrix_deals ADD COLUMN IF NOT EXISTS stage_rank int NOT NULL DEFAULT 0;

-- Lead respondeu (primeira mensagem recebida na conversa)
CREATE OR REPLACE FUNCTION public.enqueue_bitrix_replied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_company_id uuid;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT c.lead_id, c.company_id INTO v_lead_id, v_company_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_lead_id IS NULL OR v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.company_id = v_company_id AND i.provider = 'bitrix24' AND i.status = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.bitrix_sync_queue (company_id, lead_id, event)
  VALUES (v_company_id, v_lead_id, 'stage_replied')
  ON CONFLICT (lead_id, event) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_bitrix_replied() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_bitrix_replied ON public.messages;
CREATE TRIGGER trg_enqueue_bitrix_replied
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_bitrix_replied();

-- Reunião agendada
CREATE OR REPLACE FUNCTION public.enqueue_bitrix_meeting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('pending','confirmed','rescheduled') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.company_id = NEW.company_id AND i.provider = 'bitrix24' AND i.status = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.bitrix_sync_queue (company_id, lead_id, event)
  VALUES (NEW.company_id, NEW.lead_id, 'stage_meeting')
  ON CONFLICT (lead_id, event) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_bitrix_meeting() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_bitrix_meeting ON public.bookings;
CREATE TRIGGER trg_enqueue_bitrix_meeting
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_bitrix_meeting();