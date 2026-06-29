
-- Novos action types
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'fetch_existing_booking';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'reschedule_booking';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'cancel_booking';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'ask_cancel_reason';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'offer_reschedule_instead';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'send_booking_confirmation';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'offer_event_types';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'collect_booking_info';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'detect_timezone';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'send_meeting_recap';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'request_feedback';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'mark_meeting_attended';

-- Status enum para bookings
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending','confirmed','rescheduled','cancelled','no_show','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Campos novos em companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS calcom_team_id integer,
  ADD COLUMN IF NOT EXISTS calcom_round_robin_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calcom_default_event_type_id integer;

-- Tabela bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  calcom_booking_uid text UNIQUE,
  calcom_booking_id bigint,
  calcom_event_type_id integer,
  calcom_reschedule_uid text,
  status booking_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz,
  end_at timestamptz,
  duration_minutes integer,
  timezone text,
  title text,
  meeting_url text,
  location text,
  attendees jsonb DEFAULT '[]'::jsonb,
  cancel_reason text,
  reschedule_reason text,
  owner_user_id uuid,
  previous_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_company_access" ON public.bookings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id)
  WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);

CREATE INDEX IF NOT EXISTS idx_bookings_company ON public.bookings(company_id);
CREATE INDEX IF NOT EXISTS idx_bookings_lead ON public.bookings(lead_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_at ON public.bookings(scheduled_at);

CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela calcom_event_types
CREATE TABLE IF NOT EXISTS public.calcom_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  calcom_id integer NOT NULL,
  slug text,
  title text NOT NULL,
  description text,
  length_minutes integer,
  team_id integer,
  active boolean NOT NULL DEFAULT true,
  default_for_intent text,
  raw jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, calcom_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calcom_event_types TO authenticated;
GRANT ALL ON public.calcom_event_types TO service_role;
ALTER TABLE public.calcom_event_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calcom_event_types_company" ON public.calcom_event_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id)
  WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);

CREATE TRIGGER trg_calcom_event_types_updated_at BEFORE UPDATE ON public.calcom_event_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela calcom_webhook_log
CREATE TABLE IF NOT EXISTS public.calcom_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  booking_uid text,
  payload jsonb NOT NULL,
  signature_valid boolean,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.calcom_webhook_log TO authenticated;
GRANT ALL ON public.calcom_webhook_log TO service_role;
ALTER TABLE public.calcom_webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calcom_webhook_log_read" ON public.calcom_webhook_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);

CREATE INDEX IF NOT EXISTS idx_calcom_webhook_log_company ON public.calcom_webhook_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calcom_webhook_log_booking ON public.calcom_webhook_log(booking_uid);
