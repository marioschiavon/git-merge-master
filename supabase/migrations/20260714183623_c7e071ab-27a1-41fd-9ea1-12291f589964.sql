
CREATE POLICY "Company members can read whatsapp audio"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'whatsapp-audio'
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.company_id::text = (storage.foldername(name))[1]
  )
);
