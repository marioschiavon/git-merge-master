
CREATE TABLE public.cadence_custom_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.cadence_steps(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subject TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id, step_id)
);

ALTER TABLE public.cadence_custom_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company custom messages"
ON public.cadence_custom_messages
FOR SELECT
TO authenticated
USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company custom messages"
ON public.cadence_custom_messages
FOR ALL
TO authenticated
USING (company_id = get_user_company_id(auth.uid()))
WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE TRIGGER update_cadence_custom_messages_updated_at
BEFORE UPDATE ON public.cadence_custom_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
