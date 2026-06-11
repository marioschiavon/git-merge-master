ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS whatsapp_valid boolean,
  ADD COLUMN IF NOT EXISTS whatsapp_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_check_error text;