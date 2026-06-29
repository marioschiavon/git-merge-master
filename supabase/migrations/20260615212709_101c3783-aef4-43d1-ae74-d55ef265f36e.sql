ALTER TABLE public.calendar_actions DROP CONSTRAINT IF EXISTS calendar_actions_action_type_check;
ALTER TABLE public.calendar_actions ADD CONSTRAINT calendar_actions_action_type_check
  CHECK (action_type IN ('book','reschedule','cancel','add_guests'));