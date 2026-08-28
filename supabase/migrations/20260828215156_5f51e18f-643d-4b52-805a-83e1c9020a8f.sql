ALTER TABLE public.hook7_instances ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'evolution_api';
UPDATE public.hook7_instances SET engine = 'legacy' WHERE engine = 'evolution_api';
UPDATE public.hook7_instances SET status = 'disconnected', updated_at = now() WHERE engine = 'legacy' AND status = 'connected';