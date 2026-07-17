
-- Anti-spam WhatsApp: fila persistente + caps por instância + warm-up

ALTER TABLE public.hook7_instances
  ADD COLUMN IF NOT EXISTS daily_send_cap integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS hourly_send_cap integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_gap_seconds integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS max_gap_seconds integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS lead_cooldown_minutes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz;

-- Backfill warmup_started_at para instâncias já conectadas.
UPDATE public.hook7_instances
   SET warmup_started_at = COALESCE(last_connected_at, created_at)
 WHERE warmup_started_at IS NULL AND status = 'connected';

CREATE TABLE IF NOT EXISTS public.whatsapp_send_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.hook7_instances(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  approval_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  to_phone text NOT NULL,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'pending',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  sent_message_id uuid,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_send_queue_pending_idx
  ON public.whatsapp_send_queue (status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS whatsapp_send_queue_company_idx
  ON public.whatsapp_send_queue (company_id, status);
CREATE INDEX IF NOT EXISTS whatsapp_send_queue_instance_idx
  ON public.whatsapp_send_queue (instance_id, status);

GRANT SELECT ON public.whatsapp_send_queue TO authenticated;
GRANT ALL ON public.whatsapp_send_queue TO service_role;

ALTER TABLE public.whatsapp_send_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company's whatsapp queue"
  ON public.whatsapp_send_queue FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE TRIGGER whatsapp_send_queue_updated_at
BEFORE UPDATE ON public.whatsapp_send_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
