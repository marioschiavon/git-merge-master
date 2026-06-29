
-- 1.1 — Dedup de mensagens inbound
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_msgid_uniq
  ON public.messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 1.2 — Idempotência de ações de calendário
CREATE TABLE IF NOT EXISTS public.calendar_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('book','reschedule','cancel')),
  requested_start timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed')),
  provider_booking_uid text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.calendar_actions TO authenticated;
GRANT ALL ON public.calendar_actions TO service_role;

ALTER TABLE public.calendar_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_actions_company_select"
  ON public.calendar_actions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE INDEX IF NOT EXISTS calendar_actions_conversation_idx
  ON public.calendar_actions (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS calendar_actions_booking_uid_idx
  ON public.calendar_actions (provider_booking_uid)
  WHERE provider_booking_uid IS NOT NULL;

CREATE TRIGGER calendar_actions_updated_at
  BEFORE UPDATE ON public.calendar_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
