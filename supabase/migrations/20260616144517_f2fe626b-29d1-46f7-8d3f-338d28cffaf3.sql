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

CREATE POLICY "ma_select_company" ON public.message_annotations
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "ma_insert_company" ON public.message_annotations
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "ma_update_own" ON public.message_annotations
  FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY "ma_delete_own" ON public.message_annotations
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.has_role(auth.uid(), 'company_admin'::app_role)
  );

CREATE INDEX idx_ma_company_created ON public.message_annotations (company_id, created_at DESC);
CREATE INDEX idx_ma_lead ON public.message_annotations (lead_id);
CREATE INDEX idx_ma_source ON public.message_annotations (source_kind, source_id);

CREATE TRIGGER trg_ma_updated_at
  BEFORE UPDATE ON public.message_annotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();