
-- Enums
CREATE TYPE public.integration_provider AS ENUM ('pipedrive');
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'unqualified', 'converted');
CREATE TYPE public.activity_type AS ENUM ('email', 'call', 'whatsapp', 'linkedin', 'note', 'meeting');

-- Integrations table
CREATE TABLE public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL DEFAULT 'pipedrive',
  api_token text NOT NULL,
  api_domain text,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, provider)
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company integrations"
  ON public.integrations FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Company admins can manage integrations"
  ON public.integrations FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Master admins can manage all integrations"
  ON public.integrations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'master_admin'::app_role));

CREATE TRIGGER update_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Leads table
CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pipedrive_id integer,
  name text NOT NULL,
  email text,
  phone text,
  company_name text,
  title text,
  source text,
  status lead_status NOT NULL DEFAULT 'new',
  score integer DEFAULT 0,
  pipedrive_data jsonb DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, pipedrive_id)
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company leads"
  ON public.leads FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company leads"
  ON public.leads FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lead activities table
CREATE TABLE public.lead_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type activity_type NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can create activities for their company"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

-- Indexes
CREATE INDEX idx_leads_company_id ON public.leads(company_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_pipedrive_id ON public.leads(company_id, pipedrive_id);
CREATE INDEX idx_lead_activities_lead_id ON public.lead_activities(lead_id);
CREATE INDEX idx_integrations_company_provider ON public.integrations(company_id, provider);
