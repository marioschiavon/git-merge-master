ALTER TABLE public.cadences
  ADD COLUMN IF NOT EXISTS simulation_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.cadence_agent_decisions
  ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;