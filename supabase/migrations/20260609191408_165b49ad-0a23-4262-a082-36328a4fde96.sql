
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'twilio_whatsapp';

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.integrations
  ALTER COLUMN api_token DROP NOT NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';

CREATE INDEX IF NOT EXISTS idx_messages_channel ON public.messages(channel);
