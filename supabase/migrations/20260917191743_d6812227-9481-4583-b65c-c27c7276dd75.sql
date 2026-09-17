ALTER TABLE public.hook7_instances
  ADD COLUMN IF NOT EXISTS disconnect_reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disconnect_last_reminder_at timestamptz;