
-- 1) lead_insights: colunas para resumos sociais
ALTER TABLE public.lead_insights
  ADD COLUMN IF NOT EXISTS linkedin_summary text,
  ADD COLUMN IF NOT EXISTS instagram_summary text;

-- 2) company_knowledge: origin + locked + knowledge_type
ALTER TABLE public.company_knowledge
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS knowledge_type text NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_knowledge_origin_check'
  ) THEN
    ALTER TABLE public.company_knowledge
      ADD CONSTRAINT company_knowledge_origin_check
      CHECK (origin IN ('kickoff','client','admin'));
  END IF;
END $$;

-- 3) Substituir policies de UPDATE/DELETE para respeitar locked/origin
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='company_knowledge'
      AND cmd IN ('UPDATE','DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.company_knowledge', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Update company knowledge (respect lock)"
  ON public.company_knowledge
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR (
      public.get_user_company_id(auth.uid()) = company_id
      AND locked = false
      AND origin <> 'kickoff'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR (
      public.get_user_company_id(auth.uid()) = company_id
      AND locked = false
      AND origin <> 'kickoff'
    )
  );

CREATE POLICY "Delete company knowledge (respect lock)"
  ON public.company_knowledge
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR (
      public.get_user_company_id(auth.uid()) = company_id
      AND locked = false
      AND origin <> 'kickoff'
    )
  );
