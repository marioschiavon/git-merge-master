
-- Script templates table
CREATE TABLE public.script_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  segment text NOT NULL DEFAULT 'geral',
  channel public.cadence_type NOT NULL DEFAULT 'email',
  tone text NOT NULL DEFAULT 'consultivo',
  base_script text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.script_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company scripts"
  ON public.script_templates FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company scripts"
  ON public.script_templates FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE TRIGGER update_script_templates_updated_at
  BEFORE UPDATE ON public.script_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Script variations table
CREATE TABLE public.script_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.script_templates(id) ON DELETE CASCADE,
  variation_text text NOT NULL DEFAULT '',
  tone text NOT NULL DEFAULT 'consultivo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.script_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view variations of their company scripts"
  ON public.script_variations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.script_templates st
    WHERE st.id = script_variations.template_id
    AND st.company_id = public.get_user_company_id(auth.uid())
  ));

CREATE POLICY "Members can manage variations of their company scripts"
  ON public.script_variations FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.script_templates st
    WHERE st.id = script_variations.template_id
    AND st.company_id = public.get_user_company_id(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.script_templates st
    WHERE st.id = script_variations.template_id
    AND st.company_id = public.get_user_company_id(auth.uid())
  ));

-- Conversations table
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  cadence_enrollment_id uuid REFERENCES public.cadence_enrollments(id) ON DELETE SET NULL,
  channel public.cadence_type NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

-- Messages table
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'outbound',
  content text NOT NULL DEFAULT '',
  ai_suggested boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view messages of their company conversations"
  ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  ));

CREATE POLICY "Members can manage messages of their company conversations"
  ON public.messages FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  ));
