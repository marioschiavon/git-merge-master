
-- 1. Tabela company_knowledge
CREATE TABLE public.company_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'text',
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  source_url text,
  file_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company knowledge"
  ON public.company_knowledge FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Members can manage their company knowledge"
  ON public.company_knowledge FOR ALL TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE TRIGGER update_company_knowledge_updated_at
  BEFORE UPDATE ON public.company_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Tabela execution_logs
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

ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their company execution logs"
  ON public.execution_logs FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));

-- Service role inserts logs (no INSERT policy for authenticated users)

-- 3. Colunas extras em cadence_enrollments
ALTER TABLE public.cadence_enrollments
  ADD COLUMN last_executed_at timestamptz,
  ADD COLUMN next_execution_at timestamptz,
  ADD COLUMN meeting_scheduled boolean NOT NULL DEFAULT false;

-- 4. Storage bucket para documentos de conhecimento
INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge-docs', 'knowledge-docs', false);

CREATE POLICY "Authenticated users can upload knowledge docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge-docs');

CREATE POLICY "Authenticated users can view knowledge docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge-docs');

CREATE POLICY "Authenticated users can delete knowledge docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge-docs');
