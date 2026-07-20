-- Clean up orphan references before adding FKs
UPDATE public.message_annotations ma SET lead_id = NULL
  WHERE lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = ma.lead_id);
UPDATE public.message_annotations ma SET conversation_id = NULL
  WHERE conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = ma.conversation_id);
DELETE FROM public.message_annotations ma
  WHERE NOT EXISTS (SELECT 1 FROM public.companies co WHERE co.id = ma.company_id);

ALTER TABLE public.message_annotations
  ADD CONSTRAINT message_annotations_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD CONSTRAINT message_annotations_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD CONSTRAINT message_annotations_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';