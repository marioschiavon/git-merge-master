ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS handoff_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_reason text,
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS referral_followup_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_handoff_required ON public.leads (company_id) WHERE handoff_required = true;
CREATE INDEX IF NOT EXISTS idx_leads_referral_followup_pending
  ON public.leads (referral_stage, updated_at)
  WHERE referral_stage = 'aguardando_encaminhamento_interno' AND referral_followup_sent_at IS NULL;