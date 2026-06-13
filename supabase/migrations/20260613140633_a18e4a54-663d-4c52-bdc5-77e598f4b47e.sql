ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_source TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;