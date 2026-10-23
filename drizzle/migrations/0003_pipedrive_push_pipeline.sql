CREATE TABLE public.pipedrive_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('create_deal','stage_replied','stage_meeting','move_stage')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, event)
);
GRANT SELECT ON public.pipedrive_sync_queue TO authenticated;
GRANT ALL ON public.pipedrive_sync_queue TO service_role;
CREATE INDEX idx_pipedrive_queue_pending ON public.pipedrive_sync_queue (next_attempt_at) WHERE status IN ('pending','failed');
ALTER TABLE public.pipedrive_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own company pipedrive queue" ON public.pipedrive_sync_queue
  FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));

CREATE TABLE public.pipedrive_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  deal_id bigint NOT NULL,
  person_id bigint,
  org_id bigint,
  current_stage text,
  stage_rank int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, lead_id)
);
GRANT SELECT ON public.pipedrive_deals TO authenticated;
GRANT ALL ON public.pipedrive_deals TO service_role;
ALTER TABLE public.pipedrive_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own company pipedrive deals" ON public.pipedrive_deals
  FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));

CREATE TRIGGER update_pipedrive_sync_queue_updated_at BEFORE UPDATE ON public.pipedrive_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pipedrive_deals_updated_at BEFORE UPDATE ON public.pipedrive_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.pipedrive_push_enabled(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.integrations i
    WHERE i.company_id = _company_id AND i.provider = 'pipedrive' AND i.status = 'active'
      AND coalesce(i.config->>'push_enabled','false') = 'true');
$$;
REVOKE EXECUTE ON FUNCTION public.pipedrive_push_enabled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_pipedrive_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.pipedrive_push_enabled(NEW.company_id) THEN RETURN NEW; END IF;
  IF public.is_lead_protected(NEW.id) THEN RETURN NEW; END IF;
  IF NEW.status = 'contacted' AND OLD.status IS DISTINCT FROM 'contacted' THEN
    INSERT INTO public.pipedrive_sync_queue (company_id, lead_id, event)
    VALUES (NEW.company_id, NEW.id, 'create_deal') ON CONFLICT (lead_id, event) DO NOTHING;
  END IF;
  IF NEW.handoff_required = true AND OLD.handoff_required IS DISTINCT FROM true THEN
    INSERT INTO public.pipedrive_sync_queue (company_id, lead_id, event, payload)
    VALUES (NEW.company_id, NEW.id, 'move_stage', jsonb_build_object('reason', NEW.handoff_reason, 'at', NEW.handoff_at))
    ON CONFLICT (lead_id, event) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_pipedrive_lead() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_pipedrive_lead AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_pipedrive_lead();

CREATE OR REPLACE FUNCTION public.enqueue_pipedrive_replied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead uuid; v_company uuid;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'inbound' THEN RETURN NEW; END IF;
  SELECT c.lead_id, c.company_id INTO v_lead, v_company FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF v_lead IS NULL OR v_company IS NULL THEN RETURN NEW; END IF;
  IF NOT public.pipedrive_push_enabled(v_company) THEN RETURN NEW; END IF;
  IF public.is_lead_protected(v_lead) AND NOT EXISTS (SELECT 1 FROM public.pipedrive_deals d WHERE d.lead_id = v_lead) THEN RETURN NEW; END IF;
  INSERT INTO public.pipedrive_sync_queue (company_id, lead_id, event)
  VALUES (v_company, v_lead, 'stage_replied') ON CONFLICT (lead_id, event) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_pipedrive_replied() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_pipedrive_replied AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_pipedrive_replied();

CREATE OR REPLACE FUNCTION public.enqueue_pipedrive_meeting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.company_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('pending','confirmed','rescheduled') THEN RETURN NEW; END IF;
  IF NOT public.pipedrive_push_enabled(NEW.company_id) THEN RETURN NEW; END IF;
  INSERT INTO public.pipedrive_sync_queue (company_id, lead_id, event)
  VALUES (NEW.company_id, NEW.lead_id, 'stage_meeting') ON CONFLICT (lead_id, event) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_pipedrive_meeting() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_pipedrive_meeting AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_pipedrive_meeting();

CREATE OR REPLACE FUNCTION public.retry_pipedrive_failed()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.get_user_company_id(auth.uid()); n int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Empresa não identificada'; END IF;
  UPDATE public.pipedrive_sync_queue SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL
  WHERE company_id = v_company AND status IN ('failed','skipped');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.retry_pipedrive_failed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_pipedrive_failed() TO authenticated;