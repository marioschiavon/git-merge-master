
-- 1. cadences.mode
ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'static'
  CHECK (mode IN ('static','agentic'));

-- 2. cadence_policies
CREATE TABLE public.cadence_policies (
  cadence_id uuid PRIMARY KEY REFERENCES public.cadences(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  goal text NOT NULL DEFAULT 'Agendar reunião de 15 minutos',
  max_attempts int NOT NULL DEFAULT 6,
  max_days int NOT NULL DEFAULT 15,
  allowed_channels text[] NOT NULL DEFAULT ARRAY['whatsapp','email'],
  primary_channel text NOT NULL DEFAULT 'whatsapp',
  tone_instructions text NOT NULL DEFAULT 'Consultivo, curto, personalizado, sem pressão',
  continue_criteria text,
  stop_criteria_flags jsonb NOT NULL DEFAULT '{"no_interest":true,"opt_out":true,"meeting_booked":true,"handoff":true,"max_attempts":true,"max_days":true}'::jsonb,
  stop_criteria_text text,
  min_fit_score int,
  business_hours jsonb NOT NULL DEFAULT '{"start":"09:00","end":"18:00","days":[1,2,3,4,5],"tz":"America/Sao_Paulo"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_policies TO authenticated;
GRANT ALL ON public.cadence_policies TO service_role;

ALTER TABLE public.cadence_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage own company policies"
  ON public.cadence_policies FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));

CREATE TRIGGER update_cadence_policies_updated_at BEFORE UPDATE
  ON public.cadence_policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. cadence_agent_decisions
CREATE TABLE public.cadence_agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  decided_at timestamptz NOT NULL DEFAULT now(),
  attempt_number int NOT NULL DEFAULT 1,
  action text NOT NULL CHECK (action IN ('send','wait','stop','handoff_human')),
  channel text,
  hook text,
  scheduled_for timestamptz,
  message_subject text,
  message_body text,
  rationale text,
  stop_reason text,
  model text,
  tokens_used int
);

CREATE INDEX idx_cadence_agent_decisions_enrollment ON public.cadence_agent_decisions(enrollment_id, decided_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_agent_decisions TO authenticated;
GRANT ALL ON public.cadence_agent_decisions TO service_role;

ALTER TABLE public.cadence_agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own company decisions"
  ON public.cadence_agent_decisions FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));

CREATE POLICY "Service role manages decisions"
  ON public.cadence_agent_decisions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
