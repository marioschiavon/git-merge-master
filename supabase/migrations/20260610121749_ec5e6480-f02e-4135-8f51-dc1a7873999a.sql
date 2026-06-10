
ALTER TABLE public.slot_holds
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.slot_expiry_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN ('suggested_new','link_sent','closing_attempt','no_response')),
  attempts integer NOT NULL DEFAULT 0,
  next_action_at timestamptz,
  last_action_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id)
);

GRANT SELECT ON public.slot_expiry_followups TO authenticated;
GRANT ALL ON public.slot_expiry_followups TO service_role;

ALTER TABLE public.slot_expiry_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company slot expiry followups"
  ON public.slot_expiry_followups FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_slot_expiry_followups_next_action
  ON public.slot_expiry_followups (next_action_at)
  WHERE stage <> 'no_response';

CREATE TRIGGER update_slot_expiry_followups_updated_at
  BEFORE UPDATE ON public.slot_expiry_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
