
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS human_takeover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_taken_by uuid,
  ADD COLUMN IF NOT EXISTS human_takeover_reason text,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_conversations_human_inbox
  ON public.conversations (company_id, human_takeover, last_inbound_at DESC)
  WHERE human_takeover = true;

-- Backfill last_inbound_at from existing inbound messages
UPDATE public.conversations c
SET last_inbound_at = sub.last_at
FROM (
  SELECT conversation_id, MAX(sent_at) AS last_at
  FROM public.messages
  WHERE direction = 'inbound'
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id
  AND c.last_inbound_at IS NULL;
