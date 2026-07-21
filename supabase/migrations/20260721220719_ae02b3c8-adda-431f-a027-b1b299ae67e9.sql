
ALTER TABLE public.whatsapp_send_queue
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_wa_queue_priority_scheduled
  ON public.whatsapp_send_queue (priority DESC, scheduled_for ASC)
  WHERE status = 'pending';

ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

ALTER TABLE public.approval_requests
  DROP CONSTRAINT IF EXISTS approval_requests_status_check;

ALTER TABLE public.approval_requests
  ADD CONSTRAINT approval_requests_status_check
  CHECK (status = ANY (ARRAY['pending','queued','approved','rejected','edited_sent','expired','failed']::text[]));
