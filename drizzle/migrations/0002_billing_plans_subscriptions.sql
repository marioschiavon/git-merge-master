CREATE TABLE public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plans TO authenticated;
GRANT ALL ON public.billing_plans TO service_role;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "master manage billing plans" ON public.billing_plans FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'master_admin')) WITH CHECK (public.has_role(auth.uid(),'master_admin'));
INSERT INTO public.billing_plans(name,price_cents,sort_order) VALUES ('Prospect',70000,1),('Pipeline',100000,2),('Accelerate',200000,3);

ALTER TABLE public.billing_catalog ADD COLUMN included_in_plans boolean NOT NULL DEFAULT false;
UPDATE public.billing_catalog SET included_in_plans = true WHERE key IN ('bitrix24','apollo','pipedrive','calcom','gmail');
UPDATE public.billing_catalog SET active = false WHERE key = 'core';

CREATE TABLE public.company_subscriptions (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  module_keys text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_subscriptions TO authenticated;
GRANT ALL ON public.company_subscriptions TO service_role;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "master manage company subscriptions" ON public.company_subscriptions FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'master_admin')) WITH CHECK (public.has_role(auth.uid(),'master_admin'));