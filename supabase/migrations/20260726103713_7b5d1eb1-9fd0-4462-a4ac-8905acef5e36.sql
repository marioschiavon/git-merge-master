-- 1) Normalize cadences: everything now goes via Nylas ("personal").
UPDATE public.cadences
   SET email_channel = 'personal'
 WHERE email_channel IS DISTINCT FROM 'personal';

-- 2) Best-effort backfill: attach an active grant when the cadence has none.
UPDATE public.cadences c
   SET email_grant_id = g.id
  FROM (
    SELECT DISTINCT ON (company_id) id, company_id
      FROM public.user_email_grants
     WHERE status = 'active'
  ORDER BY company_id, created_at ASC
  ) g
 WHERE c.email_grant_id IS NULL
   AND c.company_id = g.company_id;

-- 3) Reopen the 3 stuck approvals so the client can re-approve and let Nylas send.
UPDATE public.approval_requests
   SET status = 'pending',
       executed_at = NULL,
       reviewed_at = NULL,
       reviewed_by = NULL,
       execution_error = NULL,
       queued_at = NULL
 WHERE id IN (
   '4a285ea0-aa9b-4ec9-9c54-3e8afaccdc03',
   '8ed35e7a-3f4a-43e0-bdca-0022c1fc3a34',
   'bed26121-2a47-4bcc-801d-71f4bf9dec82'
 );
