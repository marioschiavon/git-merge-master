ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'bitrix24';

CREATE TABLE public.bitrix_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('create_deal','move_stage')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, event)
);

GRANT SELECT ON public.bitrix_sync_queue TO authenticated;
GRANT ALL ON public.bitrix_sync_queue TO service_role;

CREATE INDEX idx_bitrix_queue_pending
  ON public.bitrix_sync_queue (next_attempt_at)
  WHERE status IN ('pending','failed');

ALTER TABLE public.bitrix_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own company bitrix queue"
  ON public.bitrix_sync_queue FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE TABLE public.bitrix_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  deal_id bigint NOT NULL,
  contact_id bigint,
  bitrix_company_id bigint,
  current_stage text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, lead_id)
);

GRANT SELECT ON public.bitrix_deals TO authenticated;
GRANT ALL ON public.bitrix_deals TO service_role;

ALTER TABLE public.bitrix_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own company bitrix deals"
  ON public.bitrix_deals FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE TRIGGER update_bitrix_sync_queue_updated_at
  BEFORE UPDATE ON public.bitrix_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bitrix_deals_updated_at
  BEFORE UPDATE ON public.bitrix_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_bitrix_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'contacted'
      AND OLD.status IS DISTINCT FROM 'contacted') THEN
    INSERT INTO public.bitrix_sync_queue (company_id, lead_id, event)
    VALUES (NEW.company_id, NEW.id, 'create_deal')
    ON CONFLICT (lead_id, event) DO NOTHING;
  END IF;

  IF (NEW.handoff_required = true
      AND OLD.handoff_required IS DISTINCT FROM true) THEN
    INSERT INTO public.bitrix_sync_queue (company_id, lead_id, event, payload)
    VALUES (NEW.company_id, NEW.id, 'move_stage',
            jsonb_build_object('reason', NEW.handoff_reason,
                               'at', NEW.handoff_at))
    ON CONFLICT (lead_id, event) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_bitrix_sync
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_bitrix_sync();