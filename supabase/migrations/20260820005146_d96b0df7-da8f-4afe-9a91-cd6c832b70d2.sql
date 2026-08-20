UPDATE public.messages m
SET channel = m.metadata->>'channel'
WHERE m.metadata->>'channel' IN ('whatsapp','linkedin','email')
  AND m.channel IS DISTINCT FROM (m.metadata->>'channel');