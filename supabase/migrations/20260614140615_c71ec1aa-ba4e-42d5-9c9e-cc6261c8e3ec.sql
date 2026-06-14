UPDATE public.leads SET pipeline_mode = 'agent' WHERE pipeline_mode IS DISTINCT FROM 'agent';
ALTER TABLE public.leads ALTER COLUMN pipeline_mode SET DEFAULT 'agent';