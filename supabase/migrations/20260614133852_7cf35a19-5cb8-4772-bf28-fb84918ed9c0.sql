CREATE TABLE IF NOT EXISTS public.processed_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  provider text,
  provider_message_id text,
  content_hash text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS processed_inbound_messages_provider_uniq
  ON public.processed_inbound_messages (lead_id, provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS processed_inbound_messages_hash_uniq
  ON public.processed_inbound_messages (lead_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS processed_inbound_messages_lead_recent
  ON public.processed_inbound_messages (lead_id, processed_at DESC);

GRANT SELECT, INSERT ON public.processed_inbound_messages TO authenticated;
GRANT ALL ON public.processed_inbound_messages TO service_role;

ALTER TABLE public.processed_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access processed_inbound_messages"
  ON public.processed_inbound_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);