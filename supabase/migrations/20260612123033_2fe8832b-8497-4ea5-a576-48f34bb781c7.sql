
-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1) lead_memory: rolling summary + extracted facts per lead
-- ============================================================
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

CREATE POLICY "Members can view their company lead memory"
  ON public.lead_memory FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Members can manage their company lead memory"
  ON public.lead_memory FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE INDEX idx_lead_memory_lead ON public.lead_memory(lead_id);
CREATE INDEX idx_lead_memory_company ON public.lead_memory(company_id);

CREATE TRIGGER trg_lead_memory_updated_at
  BEFORE UPDATE ON public.lead_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2) conversations.summary for rolling conversation summary
-- ============================================================
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS summary_message_count int NOT NULL DEFAULT 0;

-- ============================================================
-- 3) knowledge_chunks: RAG over company_knowledge
-- ============================================================
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

CREATE POLICY "Members can view their company knowledge chunks"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Members can manage their company knowledge chunks"
  ON public.knowledge_chunks FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE INDEX idx_knowledge_chunks_company ON public.knowledge_chunks(company_id);
CREATE INDEX idx_knowledge_chunks_knowledge ON public.knowledge_chunks(knowledge_id);
-- Note: HNSW index on vector(3072) is not supported by pgvector (max 2000 dims for HNSW).
-- We'll use sequential scan filtered by company_id, which is fine for small/medium KBs.
-- If KB grows large, we can switch to vector(1536) using dimensions param or use IVFFlat.

-- ============================================================
-- 4) sdr_agent_runs: observability for the unified agent
-- ============================================================
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

CREATE POLICY "Members can view their company agent runs"
  ON public.sdr_agent_runs FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE POLICY "Members can manage their company agent runs"
  ON public.sdr_agent_runs FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin'::app_role)
    OR public.get_user_company_id(auth.uid()) = company_id
  );

CREATE INDEX idx_sdr_agent_runs_lead ON public.sdr_agent_runs(lead_id, created_at DESC);
CREATE INDEX idx_sdr_agent_runs_company ON public.sdr_agent_runs(company_id, created_at DESC);

-- ============================================================
-- 5) Helper RPC for semantic search over knowledge_chunks
-- ============================================================
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_company_id uuid,
  p_query_embedding vector(3072),
  p_match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  knowledge_id uuid,
  chunk text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.knowledge_id,
    c.chunk,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks c
  WHERE c.company_id = p_company_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
