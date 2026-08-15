CREATE TABLE public.municipia_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  last_import_at timestamp with time zone,
  last_import_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.municipia_integrations TO authenticated;
GRANT ALL ON public.municipia_integrations TO service_role;

ALTER TABLE public.municipia_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own municipia integration"
ON public.municipia_integrations FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'master_admin'::app_role)
  OR public.get_user_company_id(auth.uid()) = company_id
);

CREATE POLICY "Master admin manages municipia integrations"
ON public.municipia_integrations FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'master_admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'master_admin'::app_role));

GRANT INSERT, UPDATE, DELETE ON public.municipia_integrations TO authenticated;

CREATE TRIGGER update_municipia_integrations_updated_at
BEFORE UPDATE ON public.municipia_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS municipia_source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS leads_company_municipia_source_idx
ON public.leads (company_id, municipia_source_id)
WHERE municipia_source_id IS NOT NULL;