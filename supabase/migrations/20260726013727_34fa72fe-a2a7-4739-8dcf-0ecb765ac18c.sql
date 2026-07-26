-- Cleanup ghost conversation created from Nylas self-echo events on the connected mailbox.
DELETE FROM public.approval_requests WHERE conversation_id = '9809f772-1b2c-46bb-9a94-743413bbbf9c';
DELETE FROM public.messages WHERE conversation_id = '9809f772-1b2c-46bb-9a94-743413bbbf9c';
DELETE FROM public.conversations WHERE id = '9809f772-1b2c-46bb-9a94-743413bbbf9c';

-- Also drop the duplicate NULL-from-email inbound rows on the real S7 conversation
-- (they were inserted by inbound-webhook when resend-inbound-webhook forwarded without skip_insert).
DELETE FROM public.messages
WHERE conversation_id = '668c396e-2a85-405c-955d-7f66fa1ae008'
  AND direction = 'inbound'
  AND (metadata->>'from_email') IS NULL
  AND (metadata->>'nylas_message_id') IS NULL
  AND (metadata->>'via') IS NULL;
