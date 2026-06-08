
-- 1. Adicionar 'gmail' ao enum integration_provider
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'gmail';

-- 2. Tabela singleton para configuração da conta Gmail compartilhada
CREATE TABLE IF NOT EXISTS public.gmail_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  last_history_id text,
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_account_singleton CHECK (true)
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_account_active_unique
  ON public.gmail_account ((true)) WHERE is_active;

GRANT SELECT ON public.gmail_account TO authenticated;
GRANT ALL ON public.gmail_account TO service_role;

ALTER TABLE public.gmail_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view gmail account"
  ON public.gmail_account FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_gmail_account_updated
  BEFORE UPDATE ON public.gmail_account
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Colunas em messages para casar emails recebidos
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_thread_id text,
  ADD COLUMN IF NOT EXISTS rfc_message_id text;

CREATE INDEX IF NOT EXISTS idx_messages_gmail_thread ON public.messages (gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_rfc_message ON public.messages (rfc_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_gmail_message_unique
  ON public.messages (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
