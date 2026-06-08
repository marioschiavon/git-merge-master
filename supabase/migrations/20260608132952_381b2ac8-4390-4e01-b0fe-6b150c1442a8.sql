
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS referral_source_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_role text,
  ADD COLUMN IF NOT EXISTS referral_context text,
  ADD COLUMN IF NOT EXISTS referral_permission_to_mention boolean,
  ADD COLUMN IF NOT EXISTS referral_stage text,
  ADD COLUMN IF NOT EXISTS preferred_channel text;

CREATE INDEX IF NOT EXISTS leads_referral_source_idx ON public.leads(referral_source_lead_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'activity_type' AND e.enumlabel = 'referral'
  ) THEN
    ALTER TYPE public.activity_type ADD VALUE 'referral';
  END IF;
END$$;
