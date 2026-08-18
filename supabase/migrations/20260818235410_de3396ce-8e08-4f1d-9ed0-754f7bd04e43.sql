ALTER TABLE public.municipia_integrations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'municipia_integrations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.municipia_integrations;
  END IF;
END $$;