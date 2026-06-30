CREATE TYPE public.app_role AS ENUM ('master_admin','company_admin','user');
CREATE TYPE public.company_status AS ENUM ('active','inactive','trial');

CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status public.company_status NOT NULL DEFAULT 'trial',
  logo_url TEXT,
  max_users INTEGER NOT NULL DEFAULT 5,
  max_leads INTEGER NOT NULL DEFAULT 1000,
  calcom_team_id integer,
  calcom_round_robin_enabled boolean NOT NULL DEFAULT false,
  calcom_default_event_type_id integer,
  enrichment_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  hitl_enabled boolean NOT NULL DEFAULT false,
  hitl_scopes jsonb NOT NULL DEFAULT '{"first_message":true,"sdr_reply":true,"cadence_step":true,"sensitive_action":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE public.company_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_members TO authenticated;
GRANT ALL ON public.company_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT company_id FROM public.company_members WHERE user_id = _user_id LIMIT 1 $$;

CREATE POLICY "Master admins can do everything with companies" ON public.companies FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'));
CREATE POLICY "Company members can view their company" ON public.companies FOR SELECT TO authenticated USING (id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Master admins can manage all roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'));
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Master admins can manage all members" ON public.company_members FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'));
CREATE POLICY "Company admins can manage their company members" ON public.company_members FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid()) AND public.has_role(auth.uid(),'company_admin'));
CREATE POLICY "Members can view their company members" ON public.company_members FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO public.profiles (user_id, full_name) VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name'); RETURN NEW; END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TYPE public.integration_provider AS ENUM ('pipedrive','gmail','twilio_whatsapp','apify','zapi_whatsapp');
CREATE TYPE public.lead_status AS ENUM ('new','contacted','qualified','unqualified','converted');
CREATE TYPE public.activity_type AS ENUM ('email','call','whatsapp','linkedin','note','meeting','referral');

CREATE TABLE public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL DEFAULT 'pipedrive',
  api_token text,
  api_domain text,
  status text NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company integrations" ON public.integrations FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Company admins can manage integrations" ON public.integrations FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(),'company_admin'::app_role));
CREATE POLICY "Master admins can manage all integrations" ON public.integrations FOR ALL TO authenticated USING (has_role(auth.uid(),'master_admin'::app_role));
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pipedrive_id integer,
  name text NOT NULL,
  email text,
  phone text,
  whatsapp text,
  whatsapp_source text,
  whatsapp_valid boolean,
  whatsapp_checked_at timestamptz,
  whatsapp_check_error text,
  company_name text,
  title text,
  source text,
  website text,
  address text,
  instagram_url text,
  facebook_url text,
  linkedin_url text,
  linkedin_company_url text,
  enrichment_status text,
  enrichment_updated_at timestamptz,
  status lead_status NOT NULL DEFAULT 'new',
  score integer DEFAULT 0,
  pipedrive_data jsonb DEFAULT '{}'::jsonb,
  referral_source_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  referral_role text,
  referral_context text,
  referral_permission_to_mention boolean,
  referral_stage text,
  preferred_channel text,
  handoff_required boolean NOT NULL DEFAULT false,
  handoff_reason text,
  handoff_at timestamptz,
  referral_followup_sent_at timestamptz,
  call_requested_at timestamptz,
  pending_email_slot_hold_id uuid,
  pipeline_mode text NOT NULL DEFAULT 'agent' CHECK (pipeline_mode IN ('legacy','agent')),
  referrer_name text,
  referrer_company text,
  lead_kind text NOT NULL DEFAULT 'person' CHECK (lead_kind IN ('person','company')),
  contact_identified boolean NOT NULL DEFAULT false,
  parent_company_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, pipedrive_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company leads" ON public.leads FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company leads" ON public.leads FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_leads_company_id ON public.leads(company_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_pipedrive_id ON public.leads(company_id, pipedrive_id);
CREATE INDEX idx_leads_pipeline_mode ON public.leads (company_id, pipeline_mode) WHERE pipeline_mode = 'agent';
CREATE INDEX idx_leads_parent_company ON public.leads(parent_company_lead_id) WHERE parent_company_lead_id IS NOT NULL;
CREATE INDEX idx_leads_kind_company ON public.leads(company_id, lead_kind) WHERE lead_kind = 'company';
CREATE INDEX leads_referral_source_idx ON public.leads(referral_source_lead_id);
CREATE INDEX idx_leads_handoff_required ON public.leads (company_id) WHERE handoff_required = true;
CREATE INDEX idx_leads_referral_followup_pending ON public.leads (referral_stage, updated_at) WHERE referral_stage = 'aguardando_encaminhamento_interno' AND referral_followup_sent_at IS NULL;

CREATE TABLE public.lead_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type activity_type NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company activities" ON public.lead_activities FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can create activities for their company" ON public.lead_activities FOR INSERT TO authenticated WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE INDEX idx_lead_activities_lead_id ON public.lead_activities(lead_id);
CREATE INDEX idx_integrations_company_provider ON public.integrations(company_id, provider);

CREATE TYPE public.cadence_type AS ENUM ('email','whatsapp','linkedin','multi_channel');
CREATE TYPE public.cadence_status AS ENUM ('draft','active','paused','archived');
CREATE TYPE public.enrollment_status AS ENUM ('active','completed','replied','bounced','paused');

CREATE TABLE public.cadences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type cadence_type NOT NULL DEFAULT 'email',
  status cadence_status NOT NULL DEFAULT 'draft',
  mode text NOT NULL DEFAULT 'static' CHECK (mode IN ('static','agentic')),
  simulation_mode boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'outbound' CHECK (kind IN ('outbound','referral')),
  auto_approve_first_message boolean NOT NULL DEFAULT false,
  auto_approve_max_per_day integer NOT NULL DEFAULT 50,
  reengage_enabled boolean NOT NULL DEFAULT true,
  reengage_after_days int NOT NULL DEFAULT 2,
  reengage_max_attempts int NOT NULL DEFAULT 3,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadences TO authenticated;
GRANT ALL ON public.cadences TO service_role;
ALTER TABLE public.cadences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company cadences" ON public.cadences FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company cadences" ON public.cadences FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Master admins can manage all cadences" ON public.cadences FOR ALL TO authenticated USING (has_role(auth.uid(),'master_admin'::app_role));
CREATE TRIGGER update_cadences_updated_at BEFORE UPDATE ON public.cadences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_cadences_referral ON public.cadences (company_id, status) WHERE kind = 'referral';

CREATE TABLE public.cadence_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence_id UUID NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  channel cadence_type NOT NULL DEFAULT 'email',
  template TEXT NOT NULL DEFAULT '',
  subject TEXT,
  delay_days INTEGER NOT NULL DEFAULT 1,
  smart_customization boolean NOT NULL DEFAULT true,
  use_highlights boolean NOT NULL DEFAULT true,
  use_mental_triggers boolean NOT NULL DEFAULT false,
  mental_triggers text[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cadence_id, step_order)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_steps TO authenticated;
GRANT ALL ON public.cadence_steps TO service_role;
ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view steps of their company cadences" ON public.cadence_steps FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cadences c WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid())));
CREATE POLICY "Members can manage steps of their company cadences" ON public.cadence_steps FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.cadences c WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.cadences c WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid())));
CREATE TRIGGER update_cadence_steps_updated_at BEFORE UPDATE ON public.cadence_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.cadence_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence_id UUID NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  status enrollment_status NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_executed_at timestamptz,
  next_execution_at timestamptz,
  meeting_scheduled boolean NOT NULL DEFAULT false,
  paused_reason text,
  reengage_attempts int NOT NULL DEFAULT 0,
  last_reengage_at timestamptz,
  first_message_status text CHECK (first_message_status IS NULL OR first_message_status IN ('pending_generation','generating','pending_approval','auto_approved','approved','sent','failed','skipped')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cadence_id, lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_enrollments TO authenticated;
GRANT ALL ON public.cadence_enrollments TO service_role;
ALTER TABLE public.cadence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company enrollments" ON public.cadence_enrollments FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company enrollments" ON public.cadence_enrollments FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE TRIGGER update_cadence_enrollments_updated_at BEFORE UPDATE ON public.cadence_enrollments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_cadence_enrollments_first_msg_status ON public.cadence_enrollments(first_message_status) WHERE first_message_status IS NOT NULL;

CREATE TABLE public.script_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  segment text NOT NULL DEFAULT 'geral',
  channel public.cadence_type NOT NULL DEFAULT 'email',
  tone text NOT NULL DEFAULT 'consultivo',
  base_script text NOT NULL DEFAULT '',
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_templates TO authenticated;
GRANT ALL ON public.script_templates TO service_role;
ALTER TABLE public.script_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company scripts" ON public.script_templates FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company scripts" ON public.script_templates FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid())) WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
CREATE TRIGGER update_script_templates_updated_at BEFORE UPDATE ON public.script_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.script_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.script_templates(id) ON DELETE CASCADE,
  variation_text text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT 'consultivo',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_variations TO authenticated;
GRANT ALL ON public.script_variations TO service_role;
ALTER TABLE public.script_variations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view variations of their company scripts" ON public.script_variations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.script_templates st WHERE st.id = script_variations.template_id AND st.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Members can manage variations of their company scripts" ON public.script_variations FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.script_templates st WHERE st.id = script_variations.template_id AND st.company_id = public.get_user_company_id(auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.script_templates st WHERE st.id = script_variations.template_id AND st.company_id = public.get_user_company_id(auth.uid())));

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  cadence_enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  channel public.cadence_type NOT NULL DEFAULT 'email',
  summary text,
  summary_updated_at timestamptz,
  summary_message_count int NOT NULL DEFAULT 0,
  human_takeover boolean NOT NULL DEFAULT false,
  human_taken_at timestamptz,
  human_taken_by uuid,
  human_takeover_reason text,
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company conversations" ON public.conversations FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company conversations" ON public.conversations FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid())) WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
CREATE INDEX idx_conversations_human_inbox ON public.conversations (company_id, human_takeover, last_inbound_at DESC) WHERE human_takeover = true;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'outbound',
  content text NOT NULL DEFAULT '',
  ai_suggested boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  gmail_message_id text,
  gmail_thread_id text,
  rfc_message_id text,
  channel text NOT NULL DEFAULT 'email',
  provider text,
  provider_message_id text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view messages of their company conversations" ON public.messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Members can manage messages of their company conversations" ON public.messages FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.company_id = public.get_user_company_id(auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.company_id = public.get_user_company_id(auth.uid())));
CREATE INDEX idx_messages_gmail_thread ON public.messages (gmail_thread_id);
CREATE INDEX idx_messages_rfc_message ON public.messages (rfc_message_id);
CREATE UNIQUE INDEX idx_messages_gmail_message_unique ON public.messages (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX idx_messages_channel ON public.messages(channel);
CREATE UNIQUE INDEX messages_provider_msgid_uniq ON public.messages (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE public.company_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'text',
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  source_url text,
  file_path text,
  needs_embedding boolean NOT NULL DEFAULT true,
  embedded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_knowledge TO authenticated;
GRANT ALL ON public.company_knowledge TO service_role;
ALTER TABLE public.company_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company knowledge" ON public.company_knowledge FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company knowledge" ON public.company_knowledge FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE TRIGGER update_company_knowledge_updated_at BEFORE UPDATE ON public.company_knowledge FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.cadence_steps(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email',
  action text NOT NULL DEFAULT 'sent',
  message_content text NOT NULL DEFAULT '',
  ai_context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_logs TO authenticated;
GRANT ALL ON public.execution_logs TO service_role;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company execution logs" ON public.execution_logs FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE TABLE public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','suppressed','failed','bounced','complained','dlq')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.email_send_log TO service_role;
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE INDEX idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX idx_email_send_log_recipient ON public.email_send_log(recipient_email);
CREATE INDEX idx_email_send_log_message ON public.email_send_log(message_id);
CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log(message_id) WHERE status = 'sent';

CREATE TABLE public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10,
  send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.email_send_state TO service_role;
INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN PERFORM pgmq.create(queue_name); RETURN pgmq.send(queue_name, payload);
END; $$;
CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN PERFORM pgmq.create(queue_name); RETURN;
END; $$;
CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN RETURN FALSE;
END; $$;
CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN PERFORM pgmq.create(dlq_name); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN PERFORM pgmq.delete(source_queue, message_id); EXCEPTION WHEN undefined_table THEN NULL; END;
  RETURN new_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

CREATE TABLE public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.suppressed_emails TO service_role;
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails(email);

CREATE TABLE public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

CREATE TABLE public.lead_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  website_url text,
  insights jsonb NOT NULL DEFAULT '{}',
  raw_summary text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_insights TO authenticated;
GRANT ALL ON public.lead_insights TO service_role;
ALTER TABLE public.lead_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can manage lead_insights" ON public.lead_insights FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE INDEX idx_lead_insights_lead_id ON public.lead_insights(lead_id);
CREATE INDEX idx_lead_insights_company_id ON public.lead_insights(company_id);

CREATE TABLE public.cadence_custom_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.cadence_steps(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subject TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id, step_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_custom_messages TO authenticated;
GRANT ALL ON public.cadence_custom_messages TO service_role;
ALTER TABLE public.cadence_custom_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company custom messages" ON public.cadence_custom_messages FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company custom messages" ON public.cadence_custom_messages FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE TRIGGER update_cadence_custom_messages_updated_at BEFORE UPDATE ON public.cadence_custom_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.slot_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  slot_datetime timestamptz NOT NULL,
  cal_booking_uid text,
  status text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  preferred_channel text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_holds TO authenticated;
GRANT ALL ON public.slot_holds TO service_role;
ALTER TABLE public.slot_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company slot holds" ON public.slot_holds FOR SELECT TO authenticated USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Members can manage their company slot holds" ON public.slot_holds FOR ALL TO authenticated USING (company_id = get_user_company_id(auth.uid())) WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE TABLE public.gmail_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  last_history_id text,
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gmail_account_active_unique ON public.gmail_account ((true)) WHERE is_active;
GRANT SELECT ON public.gmail_account TO authenticated;
GRANT ALL ON public.gmail_account TO service_role;
ALTER TABLE public.gmail_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view gmail account" ON public.gmail_account FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_gmail_account_updated BEFORE UPDATE ON public.gmail_account FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.delete_lead_cascade(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.leads WHERE id = p_lead_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = v_company_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = p_lead_id);
  DELETE FROM public.conversations WHERE lead_id = p_lead_id;
  DELETE FROM public.cadence_custom_messages WHERE lead_id = p_lead_id;
  DELETE FROM public.cadence_enrollments WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_insights WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_activities WHERE lead_id = p_lead_id;
  DELETE FROM public.execution_logs WHERE lead_id = p_lead_id;
  DELETE FROM public.slot_holds WHERE lead_id = p_lead_id;
  DELETE FROM public.leads WHERE id = p_lead_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_lead_cascade(uuid) TO authenticated;

CREATE TYPE public.intent_category AS ENUM ('interest','info_request','pricing','scheduling','rejection','routing','channel_switch','compliance','escalation','silence');
CREATE TYPE public.action_type AS ENUM ('send_reply','ask_clarifying_question','suggest_meeting_times','create_cal_booking','send_calendar_link','send_email','create_new_contact','mark_current_contact_as_referrer','schedule_followup','stop_sequence','mark_opt_out','handoff_to_human','create_call_task','send_material','update_lead_score','disqualify_lead','recover_no_show','request_info_from_lead','fetch_existing_booking','reschedule_booking','cancel_booking','ask_cancel_reason','offer_reschedule_instead','send_booking_confirmation','offer_event_types','collect_booking_info','detect_timezone','send_meeting_recap','request_feedback','mark_meeting_attended','acknowledge_cancellation');
CREATE TYPE public.action_status AS ENUM ('pending','done','failed','cancelled','skipped');

CREATE TABLE public.lead_intents_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  category public.intent_category NOT NULL,
  sub_intent text,
  sentiment text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_excerpt text,
  model_used text,
  latency_ms integer,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intents_log_company_created ON public.lead_intents_log(company_id, created_at DESC);
CREATE INDEX idx_intents_log_lead ON public.lead_intents_log(lead_id, created_at DESC);
GRANT SELECT, INSERT ON public.lead_intents_log TO authenticated;
GRANT ALL ON public.lead_intents_log TO service_role;
ALTER TABLE public.lead_intents_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intents_log_select_company" ON public.lead_intents_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "intents_log_insert_service" ON public.lead_intents_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role));

CREATE TABLE public.intent_action_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category public.intent_category NOT NULL,
  sub_intent text,
  priority integer NOT NULL DEFAULT 100,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_execute boolean NOT NULL DEFAULT true,
  requires_confidence_above numeric(4,3) NOT NULL DEFAULT 0.700,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intent_rules_lookup ON public.intent_action_rules(company_id, category, enabled, priority);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intent_action_rules TO authenticated;
GRANT ALL ON public.intent_action_rules TO service_role;
ALTER TABLE public.intent_action_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intent_rules_select" ON public.intent_action_rules FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "intent_rules_manage_admin" ON public.intent_action_rules FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR (public.has_role(auth.uid(),'company_admin'::app_role) AND public.get_user_company_id(auth.uid()) = company_id)) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR (public.has_role(auth.uid(),'company_admin'::app_role) AND public.get_user_company_id(auth.uid()) = company_id));
CREATE TRIGGER update_intent_action_rules_updated_at BEFORE UPDATE ON public.intent_action_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_action_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  intent_log_id uuid REFERENCES public.lead_intents_log(id) ON DELETE SET NULL,
  action_type public.action_type NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status public.action_status NOT NULL DEFAULT 'pending',
  triggered_by text,
  attempts integer NOT NULL DEFAULT 0,
  executed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_action_queue_pending ON public.lead_action_queue(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_action_queue_company ON public.lead_action_queue(company_id, created_at DESC);
CREATE INDEX idx_action_queue_lead ON public.lead_action_queue(lead_id, created_at DESC);
GRANT SELECT, UPDATE ON public.lead_action_queue TO authenticated;
GRANT ALL ON public.lead_action_queue TO service_role;
ALTER TABLE public.lead_action_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "action_queue_select" ON public.lead_action_queue FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "action_queue_update_admin" ON public.lead_action_queue FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR (public.has_role(auth.uid(),'company_admin'::app_role) AND public.get_user_company_id(auth.uid()) = company_id));
CREATE TRIGGER update_lead_action_queue_updated_at BEFORE UPDATE ON public.lead_action_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$ BEGIN CREATE TYPE booking_status AS ENUM ('pending','confirmed','rescheduled','cancelled','no_show','completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.bookings (
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
  cancellation_source text,
  cancellation_requested_at timestamptz,
  source text NOT NULL DEFAULT 'sdr_agent',
  owner_user_id uuid,
  previous_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_company_access" ON public.bookings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX idx_bookings_company ON public.bookings(company_id);
CREATE INDEX idx_bookings_lead ON public.bookings(lead_id);
CREATE INDEX idx_bookings_status ON public.bookings(company_id, status);
CREATE INDEX idx_bookings_scheduled_at ON public.bookings(scheduled_at);
CREATE INDEX bookings_source_idx ON public.bookings(source);
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.calcom_event_types (
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
CREATE POLICY "calcom_event_types_company" ON public.calcom_event_types FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE TRIGGER trg_calcom_event_types_updated_at BEFORE UPDATE ON public.calcom_event_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.calcom_webhook_log (
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
CREATE POLICY "calcom_webhook_log_read" ON public.calcom_webhook_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX idx_calcom_webhook_log_company ON public.calcom_webhook_log(company_id, created_at DESC);
CREATE INDEX idx_calcom_webhook_log_booking ON public.calcom_webhook_log(booking_uid);

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.slot_expiry_followups (
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
CREATE POLICY "Members can view their company slot expiry followups" ON public.slot_expiry_followups FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()));
CREATE INDEX idx_slot_expiry_followups_next_action ON public.slot_expiry_followups (next_action_at) WHERE stage <> 'no_response';
CREATE TRIGGER update_slot_expiry_followups_updated_at BEFORE UPDATE ON public.slot_expiry_followups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  steps_done jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lej_company ON public.lead_enrichment_jobs(company_id);
CREATE INDEX idx_lej_status_next ON public.lead_enrichment_jobs(status, next_run_at);
CREATE UNIQUE INDEX uq_lej_lead_open ON public.lead_enrichment_jobs(lead_id) WHERE status IN ('pending','processing');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_enrichment_jobs TO authenticated;
GRANT ALL ON public.lead_enrichment_jobs TO service_role;
ALTER TABLE public.lead_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage company enrichment jobs" ON public.lead_enrichment_jobs FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin')) WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));
CREATE TRIGGER trg_lej_updated BEFORE UPDATE ON public.lead_enrichment_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_social_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  network text NOT NULL,
  handle text,
  url text,
  bio text,
  followers int,
  recent_posts jsonb,
  posts_summary text,
  raw jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, network)
);
CREATE INDEX idx_lsp_company ON public.lead_social_profiles(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_social_profiles TO authenticated;
GRANT ALL ON public.lead_social_profiles TO service_role;
ALTER TABLE public.lead_social_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage company social profiles" ON public.lead_social_profiles FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin')) WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));
CREATE TRIGGER trg_lsp_updated BEFORE UPDATE ON public.lead_social_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_lead_enrichment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb;
BEGIN
  SELECT enrichment_settings INTO s FROM public.companies WHERE id = NEW.company_id;
  IF s IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((s->>'website_analysis')::bool,false) OR COALESCE((s->>'discover_socials')::bool,false)
     OR COALESCE((s->>'apify_scrape')::bool,false) OR COALESCE((s->>'generate_message')::bool,false) THEN
    INSERT INTO public.lead_enrichment_jobs (lead_id, company_id) VALUES (NEW.id, NEW.company_id)
    ON CONFLICT (lead_id) WHERE status IN ('pending','processing') DO NOTHING;
    UPDATE public.leads SET enrichment_status='pending', enrichment_updated_at=now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_leads_enqueue_enrichment AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enqueue_lead_enrichment();

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
CREATE POLICY "Members manage own company policies" ON public.cadence_policies FOR ALL TO authenticated USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin')) WITH CHECK (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));
CREATE TRIGGER update_cadence_policies_updated_at BEFORE UPDATE ON public.cadence_policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
  tokens_used int,
  simulated boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_cadence_agent_decisions_enrollment ON public.cadence_agent_decisions(enrollment_id, decided_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_agent_decisions TO authenticated;
GRANT ALL ON public.cadence_agent_decisions TO service_role;
ALTER TABLE public.cadence_agent_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own company decisions" ON public.cadence_agent_decisions FOR SELECT TO authenticated USING (company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'master_admin'));
CREATE POLICY "Service role manages decisions" ON public.cadence_agent_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.lead_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  summary text,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_memory TO authenticated;
GRANT ALL ON public.lead_memory TO service_role;
ALTER TABLE public.lead_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company lead memory" ON public.lead_memory FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Members can manage their company lead memory" ON public.lead_memory FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX idx_lead_memory_lead ON public.lead_memory(lead_id);
CREATE INDEX idx_lead_memory_company ON public.lead_memory(company_id);
CREATE TRIGGER trg_lead_memory_updated_at BEFORE UPDATE ON public.lead_memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  knowledge_id uuid REFERENCES public.company_knowledge(id) ON DELETE CASCADE,
  chunk text NOT NULL,
  embedding vector(3072),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_count int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company knowledge chunks" ON public.knowledge_chunks FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Members can manage their company knowledge chunks" ON public.knowledge_chunks FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX idx_knowledge_chunks_company ON public.knowledge_chunks(company_id);
CREATE INDEX idx_knowledge_chunks_knowledge ON public.knowledge_chunks(knowledge_id);

CREATE TABLE public.sdr_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  trigger text NOT NULL,
  mode text NOT NULL DEFAULT 'shadow',
  status text NOT NULL DEFAULT 'running',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_output jsonb,
  error text,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency_ms int,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_agent_runs TO authenticated;
GRANT ALL ON public.sdr_agent_runs TO service_role;
ALTER TABLE public.sdr_agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their company agent runs" ON public.sdr_agent_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Members can manage their company agent runs" ON public.sdr_agent_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX idx_sdr_agent_runs_lead ON public.sdr_agent_runs(lead_id, created_at DESC);
CREATE INDEX idx_sdr_agent_runs_company ON public.sdr_agent_runs(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_company_id uuid, p_query_embedding vector(3072), p_match_count int DEFAULT 5)
RETURNS TABLE (id uuid, knowledge_id uuid, chunk text, metadata jsonb, similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.knowledge_id, c.chunk, c.metadata, 1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks c
  WHERE c.company_id = p_company_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding LIMIT p_match_count;
$$;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_knowledge_needs_embedding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.needs_embedding := true;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_mark_knowledge_needs_embedding BEFORE INSERT OR UPDATE ON public.company_knowledge FOR EACH ROW EXECUTE FUNCTION public.mark_knowledge_needs_embedding();

CREATE TABLE public.pending_inbound_runs (
  lead_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  conversation_id uuid,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pending_inbound_runs_status_sched ON public.pending_inbound_runs (status, scheduled_at);
GRANT ALL ON public.pending_inbound_runs TO service_role;
ALTER TABLE public.pending_inbound_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.pending_inbound_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pending_inbound_runs_updated BEFORE UPDATE ON public.pending_inbound_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.calendar_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('book','reschedule','cancel','add_guests')),
  requested_start timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed')),
  provider_booking_uid text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.calendar_actions TO authenticated;
GRANT ALL ON public.calendar_actions TO service_role;
ALTER TABLE public.calendar_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calendar_actions_company_select" ON public.calendar_actions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE INDEX calendar_actions_conversation_idx ON public.calendar_actions (conversation_id, created_at DESC);
CREATE INDEX calendar_actions_booking_uid_idx ON public.calendar_actions (provider_booking_uid) WHERE provider_booking_uid IS NOT NULL;
CREATE TRIGGER calendar_actions_updated_at BEFORE UPDATE ON public.calendar_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.processed_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  provider text,
  provider_message_id text,
  content_hash text,
  content_bucket bigint,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX processed_inbound_messages_provider_uniq ON public.processed_inbound_messages (lead_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX processed_inbound_messages_hash_bucket_uniq ON public.processed_inbound_messages (lead_id, content_hash, content_bucket) WHERE content_hash IS NOT NULL AND content_bucket IS NOT NULL;
CREATE INDEX processed_inbound_messages_lead_recent ON public.processed_inbound_messages (lead_id, processed_at DESC);
CREATE INDEX processed_inbound_messages_hash_recent ON public.processed_inbound_messages (lead_id, content_hash, processed_at DESC) WHERE content_hash IS NOT NULL;
GRANT SELECT, INSERT ON public.processed_inbound_messages TO authenticated;
GRANT ALL ON public.processed_inbound_messages TO service_role;
ALTER TABLE public.processed_inbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access processed_inbound_messages" ON public.processed_inbound_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('first_message','sdr_reply','cadence_step','sensitive_action')),
  channel text,
  action text NOT NULL DEFAULT 'send',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_payload jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','edited_sent','expired','failed')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  executed_at timestamptz,
  execution_error text,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_requests_company_status ON public.approval_requests(company_id, status, created_at DESC);
CREATE INDEX idx_approval_requests_lead ON public.approval_requests(lead_id);
CREATE INDEX idx_approval_requests_enrollment ON public.approval_requests(enrollment_id);
CREATE INDEX idx_approval_requests_batch ON public.approval_requests(batch_id) WHERE batch_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view approvals" ON public.approval_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Company members can update approvals" ON public.approval_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Company members can insert approvals" ON public.approval_requests FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Company members can delete approvals" ON public.approval_requests FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE TRIGGER approval_requests_updated_at BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.approval_requests REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.message_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('approval_request','cadence_agent_decision')),
  source_id uuid NOT NULL,
  lead_id uuid,
  conversation_id uuid,
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  human_action text CHECK (human_action IN ('approved','edited','rejected','none')),
  final_content text,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_annotations TO authenticated;
GRANT ALL ON public.message_annotations TO service_role;
ALTER TABLE public.message_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ma_select_company" ON public.message_annotations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "ma_insert_company" ON public.message_annotations FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid() AND public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "ma_update_own" ON public.message_annotations FOR UPDATE TO authenticated USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());
CREATE POLICY "ma_delete_own" ON public.message_annotations FOR DELETE TO authenticated USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'master_admin'::app_role) OR public.has_role(auth.uid(),'company_admin'::app_role));
CREATE INDEX idx_ma_company_created ON public.message_annotations (company_id, created_at DESC);
CREATE INDEX idx_ma_lead ON public.message_annotations (lead_id);
CREATE INDEX idx_ma_source ON public.message_annotations (source_kind, source_id);
CREATE TRIGGER trg_ma_updated_at BEFORE UPDATE ON public.message_annotations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'csv',
  file_name text,
  notes text,
  default_cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  lead_count integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  folder text,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_lists_source_chk CHECK (source IN ('csv','pipedrive','manual','api'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_lists TO authenticated;
GRANT ALL ON public.lead_lists TO service_role;
ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_lists company members select" ON public.lead_lists FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "lead_lists company members insert" ON public.lead_lists FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "lead_lists company members update" ON public.lead_lists FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "lead_lists company members delete" ON public.lead_lists FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE TRIGGER trg_lead_lists_updated_at BEFORE UPDATE ON public.lead_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_lead_lists_company ON public.lead_lists(company_id, created_at DESC);
CREATE INDEX idx_lead_lists_folder ON public.lead_lists(company_id, folder) WHERE folder IS NOT NULL;
CREATE INDEX idx_lead_lists_archived ON public.lead_lists(company_id, archived_at);

ALTER TABLE public.leads ADD COLUMN lead_list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_lead_list ON public.leads(lead_list_id) WHERE lead_list_id IS NOT NULL;

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL,
  cadence_id uuid REFERENCES public.cadences(id) ON DELETE SET NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('review','auto','scheduled')),
  scheduled_for timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','completed','cancelled')),
  total_leads integer NOT NULL DEFAULT 0,
  enrolled_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view campaigns" ON public.campaigns FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE POLICY "Company members can manage campaigns" ON public.campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id) WITH CHECK (public.has_role(auth.uid(),'master_admin'::app_role) OR public.get_user_company_id(auth.uid()) = company_id);
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_campaigns_company ON public.campaigns(company_id, created_at DESC);
CREATE INDEX idx_campaigns_list ON public.campaigns(list_id);

CREATE OR REPLACE FUNCTION public.after_enrichment_done()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead_list_id uuid; v_company_id uuid; v_cadence_id uuid; v_existing uuid;
BEGIN
  IF NEW.status <> 'done' OR (TG_OP = 'UPDATE' AND OLD.status = 'done') THEN RETURN NEW; END IF;
  SELECT lead_list_id, company_id INTO v_lead_list_id, v_company_id FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead_list_id IS NULL THEN RETURN NEW; END IF;
  SELECT default_cadence_id INTO v_cadence_id FROM public.lead_lists WHERE id = v_lead_list_id;
  IF v_cadence_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_existing FROM public.cadence_enrollments WHERE lead_id = NEW.lead_id AND cadence_id = v_cadence_id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cadence_enrollments (company_id, lead_id, cadence_id, status, first_message_status, current_step, enrolled_at)
  VALUES (v_company_id, NEW.lead_id, v_cadence_id, 'active', 'pending_generation', 0, now());
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_after_enrichment_done AFTER INSERT OR UPDATE OF status ON public.lead_enrichment_jobs FOR EACH ROW EXECUTE FUNCTION public.after_enrichment_done();