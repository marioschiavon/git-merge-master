CREATE TABLE public.billing_catalog (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'module',
  price_cents integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_catalog TO authenticated;
GRANT ALL ON public.billing_catalog TO service_role;
ALTER TABLE public.billing_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "master manage billing catalog" ON public.billing_catalog FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'master_admin')) WITH CHECK (public.has_role(auth.uid(),'master_admin'));
INSERT INTO public.billing_catalog(key,name,description,kind,sort_order) VALUES
('core','Assinatura base','Leads, cadências, WhatsApp Hook7, aprovações, dashboard e acompanhamento','base',0),
('municipia','MunicipIA','Importação de prefeituras e órgãos públicos','module',1),
('social_enrichment','Enriquecimento de redes','Leitura de Instagram/LinkedIn pelo site do lead','module',2),
('bitrix24','Bitrix24','Sincronização com o CRM Bitrix24','module',3),
('apollo','Apollo','Busca e importação de contatos Apollo','module',4),
('pipedrive','Pipedrive','Integração com Pipedrive','module',5),
('calcom','Cal.com','Agendamento automático de reuniões','module',6),
('gmail','Gmail','Envio de cadências pela caixa Gmail','module',7);