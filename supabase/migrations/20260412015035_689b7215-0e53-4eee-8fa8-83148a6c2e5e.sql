ALTER TABLE public.cadence_steps ADD COLUMN use_mental_triggers boolean NOT NULL DEFAULT false;
ALTER TABLE public.cadence_steps ADD COLUMN mental_triggers text[] DEFAULT '{}';