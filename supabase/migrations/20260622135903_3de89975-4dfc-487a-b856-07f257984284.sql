ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS reengage_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reengage_after_days INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS reengage_max_attempts INT NOT NULL DEFAULT 3;

ALTER TABLE public.cadence_enrollments
  ADD COLUMN IF NOT EXISTS reengage_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reengage_at TIMESTAMPTZ;