
-- Enums
CREATE TYPE public.intent_category AS ENUM (
  'interest', 'info_request', 'pricing', 'scheduling', 'rejection',
  'routing', 'channel_switch', 'compliance', 'escalation', 'silence'
);

CREATE TYPE public.action_type AS ENUM (
  'send_reply', 'ask_clarifying_question', 'suggest_meeting_times', 'create_cal_booking',
  'send_calendar_link', 'send_email', 'create_new_contact', 'mark_current_contact_as_referrer',
  'schedule_followup', 'stop_sequence', 'mark_opt_out', 'handoff_to_human',
  'create_call_task', 'send_material', 'update_lead_score', 'disqualify_lead',
  'recover_no_show', 'request_info_from_lead'
);

CREATE TYPE public.action_status AS ENUM ('pending', 'done', 'failed', 'cancelled', 'skipped');

-- lead_intents_log
CREATE TABLE public.lead_intents_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  category public.intent_category NOT NULL,
  sub_intent text,
  sentiment text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_excerpt text,
  model_used text,
  latency_ms integer,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intents_log_company_created ON public.lead_intents_log(company_id, created_at DESC);
CREATE INDEX idx_intents_log_lead ON public.lead_intents_log(lead_id, created_at DESC);

GRANT SELECT, INSERT ON public.lead_intents_log TO authenticated;
GRANT ALL ON public.lead_intents_log TO service_role;
ALTER TABLE public.lead_intents_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intents_log_select_company"
  ON public.lead_intents_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role)
         OR public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "intents_log_insert_service"
  ON public.lead_intents_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'master_admin'::app_role));

-- intent_action_rules
CREATE TABLE public.intent_action_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category public.intent_category NOT NULL,
  sub_intent text,
  priority integer NOT NULL DEFAULT 100,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_execute boolean NOT NULL DEFAULT true,
  requires_confidence_above numeric(4,3) NOT NULL DEFAULT 0.700,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intent_rules_lookup ON public.intent_action_rules(company_id, category, enabled, priority);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intent_action_rules TO authenticated;
GRANT ALL ON public.intent_action_rules TO service_role;
ALTER TABLE public.intent_action_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intent_rules_select"
  ON public.intent_action_rules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role)
         OR public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "intent_rules_manage_admin"
  ON public.intent_action_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role)
         OR (public.has_role(auth.uid(), 'company_admin'::app_role)
             AND public.get_user_company_id(auth.uid()) = company_id))
  WITH CHECK (public.has_role(auth.uid(), 'master_admin'::app_role)
              OR (public.has_role(auth.uid(), 'company_admin'::app_role)
                  AND public.get_user_company_id(auth.uid()) = company_id));

CREATE TRIGGER update_intent_action_rules_updated_at
  BEFORE UPDATE ON public.intent_action_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- lead_action_queue
CREATE TABLE public.lead_action_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  intent_log_id uuid REFERENCES public.lead_intents_log(id) ON DELETE SET NULL,
  action_type public.action_type NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status public.action_status NOT NULL DEFAULT 'pending',
  triggered_by text,
  attempts integer NOT NULL DEFAULT 0,
  executed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_queue_pending ON public.lead_action_queue(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_action_queue_company ON public.lead_action_queue(company_id, created_at DESC);
CREATE INDEX idx_action_queue_lead ON public.lead_action_queue(lead_id, created_at DESC);

GRANT SELECT, UPDATE ON public.lead_action_queue TO authenticated;
GRANT ALL ON public.lead_action_queue TO service_role;
ALTER TABLE public.lead_action_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "action_queue_select"
  ON public.lead_action_queue FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role)
         OR public.get_user_company_id(auth.uid()) = company_id);

CREATE POLICY "action_queue_update_admin"
  ON public.lead_action_queue FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'::app_role)
         OR (public.has_role(auth.uid(), 'company_admin'::app_role)
             AND public.get_user_company_id(auth.uid()) = company_id));

CREATE TRIGGER update_lead_action_queue_updated_at
  BEFORE UPDATE ON public.lead_action_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default rules for every existing company
INSERT INTO public.intent_action_rules (company_id, category, actions, auto_execute, requires_confidence_above, priority)
SELECT c.id, cat.category, cat.actions::jsonb, cat.auto_exec, cat.thr, 100
FROM public.companies c
CROSS JOIN (
  VALUES
    ('interest'::public.intent_category, '[{"type":"send_reply"},{"type":"update_lead_score","params":{"delta":20}}]', true, 0.7),
    ('info_request'::public.intent_category, '[{"type":"send_reply"},{"type":"send_material","params":{"auto_select":true}}]', true, 0.7),
    ('pricing'::public.intent_category, '[{"type":"send_reply"},{"type":"schedule_followup","params":{"days":2}},{"type":"update_lead_score","params":{"delta":15}}]', true, 0.7),
    ('scheduling'::public.intent_category, '[{"type":"suggest_meeting_times"}]', true, 0.7),
    ('rejection'::public.intent_category, '[{"type":"send_reply","params":{"tone":"polite"}},{"type":"stop_sequence"},{"type":"disqualify_lead"}]', true, 0.75),
    ('routing'::public.intent_category, '[{"type":"create_new_contact"},{"type":"mark_current_contact_as_referrer"},{"type":"send_reply"}]', false, 0.7),
    ('channel_switch'::public.intent_category, '[{"type":"send_email"}]', false, 0.7),
    ('compliance'::public.intent_category, '[{"type":"mark_opt_out"},{"type":"stop_sequence"},{"type":"handoff_to_human"}]', true, 0.6),
    ('escalation'::public.intent_category, '[{"type":"handoff_to_human"}]', true, 0.6),
    ('silence'::public.intent_category, '[{"type":"schedule_followup","params":{"days":2}}]', true, 0.5)
) AS cat(category, actions, auto_exec, thr);
