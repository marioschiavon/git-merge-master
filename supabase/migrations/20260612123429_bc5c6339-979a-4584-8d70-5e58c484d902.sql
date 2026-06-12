
-- Restrict the new semantic search function to authenticated + service_role only
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) TO authenticated, service_role;

-- Trigger to mark knowledge as needing re-embedding when content changes
-- We use a NOTIFY channel that a cron can drain, OR we just rely on manual re-index for now.
-- Simpler: add a column `needs_embedding` and the cron picks it up.
ALTER TABLE public.company_knowledge
  ADD COLUMN IF NOT EXISTS needs_embedding boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_knowledge_needs_embedding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.needs_embedding := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_knowledge_needs_embedding ON public.company_knowledge;
CREATE TRIGGER trg_mark_knowledge_needs_embedding
  BEFORE INSERT OR UPDATE ON public.company_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.mark_knowledge_needs_embedding();
