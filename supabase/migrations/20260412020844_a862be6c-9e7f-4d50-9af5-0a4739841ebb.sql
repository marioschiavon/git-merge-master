
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
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slot_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company slot holds"
  ON public.slot_holds FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company slot holds"
  ON public.slot_holds FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
