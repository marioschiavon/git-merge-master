import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type IntentCategory =
  | "interest" | "info_request" | "pricing" | "scheduling" | "rejection"
  | "routing" | "channel_switch" | "compliance" | "escalation" | "silence";

export const CATEGORY_LABELS: Record<IntentCategory, string> = {
  interest: "Interesse",
  info_request: "Pedido de informação",
  pricing: "Preço",
  scheduling: "Agendamento",
  rejection: "Recusa",
  routing: "Redirecionamento / Indicação",
  channel_switch: "Mudança de canal",
  compliance: "Opt-out / Reclamação",
  escalation: "Escalonamento humano",
  silence: "Silêncio (cron)",
};

export const ACTION_LABELS: Record<string, string> = {
  send_reply: "Enviar resposta",
  ask_clarifying_question: "Pedir esclarecimento",
  suggest_meeting_times: "Sugerir horários",
  create_cal_booking: "Criar reunião (Cal.com)",
  send_calendar_link: "Enviar link de calendário",
  send_email: "Enviar e-mail",
  create_new_contact: "Criar novo contato",
  mark_current_contact_as_referrer: "Marcar como indicante",
  schedule_followup: "Agendar follow-up",
  stop_sequence: "Parar cadência",
  mark_opt_out: "Marcar opt-out",
  handoff_to_human: "Passar para humano",
  create_call_task: "Criar tarefa de ligação",
  send_material: "Enviar material",
  update_lead_score: "Atualizar score",
  disqualify_lead: "Desqualificar lead",
  recover_no_show: "Recuperar no-show",
  request_info_from_lead: "Solicitar info ao lead",
};

export function useIntentRules() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["intent_rules", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("intent_action_rules" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("category")
        .order("priority");
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useUpdateIntentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: { id: string; actions?: any; auto_execute?: boolean; requires_confidence_above?: number; enabled?: boolean }) => {
      const { id, ...patch } = rule;
      const { error } = await supabase.from("intent_action_rules" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intent_rules"] });
      toast.success("Regra atualizada");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useIntentLog(limit = 100) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["intent_log", companyId, limit],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("lead_intents_log" as any)
        .select("*, leads(name, company_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useActionQueue() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["action_queue", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("lead_action_queue" as any)
        .select("*, leads(name, company_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useCancelAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lead_action_queue" as any).update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action_queue"] });
      toast.success("Ação cancelada");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRunActionNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke("execute-action", { body: { action_id: id } });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action_queue"] });
      toast.success("Ação executada");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
