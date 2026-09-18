ALTER TABLE public.hook7_instances
  ADD COLUMN IF NOT EXISTS auto_restart_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_restart_last_at timestamptz;