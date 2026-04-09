
-- Enum for cadence type
CREATE TYPE public.cadence_type AS ENUM ('email', 'whatsapp', 'linkedin', 'multi_channel');

-- Enum for cadence status
CREATE TYPE public.cadence_status AS ENUM ('draft', 'active', 'paused', 'archived');

-- Enum for enrollment status
CREATE TYPE public.enrollment_status AS ENUM ('active', 'completed', 'replied', 'bounced', 'paused');

-- Cadences table
CREATE TABLE public.cadences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type cadence_type NOT NULL DEFAULT 'email',
  status cadence_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cadences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company cadences"
  ON public.cadences FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company cadences"
  ON public.cadences FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Master admins can manage all cadences"
  ON public.cadences FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'master_admin'::app_role));

CREATE TRIGGER update_cadences_updated_at
  BEFORE UPDATE ON public.cadences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cadence steps table
CREATE TABLE public.cadence_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence_id UUID NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  channel cadence_type NOT NULL DEFAULT 'email',
  template TEXT NOT NULL DEFAULT '',
  subject TEXT,
  delay_days INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (cadence_id, step_order)
);

ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view steps of their company cadences"
  ON public.cadence_steps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cadences c
    WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid())
  ));

CREATE POLICY "Members can manage steps of their company cadences"
  ON public.cadence_steps FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cadences c
    WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cadences c
    WHERE c.id = cadence_id AND c.company_id = get_user_company_id(auth.uid())
  ));

CREATE TRIGGER update_cadence_steps_updated_at
  BEFORE UPDATE ON public.cadence_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cadence enrollments table
CREATE TABLE public.cadence_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence_id UUID NOT NULL REFERENCES public.cadences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  status enrollment_status NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (cadence_id, lead_id)
);

ALTER TABLE public.cadence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company enrollments"
  ON public.cadence_enrollments FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company enrollments"
  ON public.cadence_enrollments FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE TRIGGER update_cadence_enrollments_updated_at
  BEFORE UPDATE ON public.cadence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
