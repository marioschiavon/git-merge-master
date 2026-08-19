select cron.schedule(
  'whatsapp-verify-numbers-daily',
  '20 12 * * *',
  $$
  select net.http_post(
    url := 'https://plfcbbqzpcbgykfervnp.supabase.co/functions/v1/whatsapp-verify-numbers',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsZmNiYnF6cGNiZ3lrZmVydm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzI4NTQsImV4cCI6MjA5ODM0ODg1NH0.xhASlOxavpOFmd0tyRGf0oZhhoNgGh_1eN0t1nVg5Ao"}'::jsonb,
    body := jsonb_build_object('scan', true, 'limit', 300)
  );
  $$
);