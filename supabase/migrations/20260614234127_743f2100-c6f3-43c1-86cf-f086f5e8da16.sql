ALTER TABLE public.cadences ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'outbound';
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_kind_check;
ALTER TABLE public.cadences ADD CONSTRAINT cadences_kind_check CHECK (kind IN ('outbound', 'referral'));
CREATE INDEX IF NOT EXISTS idx_cadences_referral ON public.cadences (company_id, status) WHERE kind = 'referral';