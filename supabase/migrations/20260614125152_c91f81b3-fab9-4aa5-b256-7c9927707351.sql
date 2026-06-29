ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sdr_agent';
CREATE INDEX IF NOT EXISTS bookings_source_idx ON public.bookings(source);
ALTER TABLE public.calendar_actions ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS calendar_actions_provider_uid_idx ON public.calendar_actions(provider_booking_uid) WHERE provider_booking_uid IS NOT NULL;