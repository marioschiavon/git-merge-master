ALTER TABLE public.processed_inbound_messages ADD COLUMN IF NOT EXISTS content_bucket BIGINT;

DROP INDEX IF EXISTS public.processed_inbound_messages_hash_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS processed_inbound_messages_hash_bucket_uniq
  ON public.processed_inbound_messages (lead_id, content_hash, content_bucket)
  WHERE content_hash IS NOT NULL AND content_bucket IS NOT NULL;

CREATE INDEX IF NOT EXISTS processed_inbound_messages_hash_recent
  ON public.processed_inbound_messages (lead_id, content_hash, processed_at DESC)
  WHERE content_hash IS NOT NULL;