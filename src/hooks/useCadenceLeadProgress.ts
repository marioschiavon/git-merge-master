import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CadenceLeadProgressRow = {
  enrollment: any;
  lead: any;
  lastMessage: { content: string | null; direction: string; channel: string | null; sent_at: string; metadata: any } | null;
  lastIntent: { category: string | null; sub_intent: string | null; confidence: number | null; created_at: string } | null;
  nextStep: { step_order: number; channel: string; subject: string | null } | null;
  totalSteps: number;
};

export function useCadenceLeadProgress(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_lead_progress", cadenceId],
    queryFn: async (): Promise<CadenceLeadProgressRow[]> => {
      if (!cadenceId) return [];

      const [{ data: enrollments }, { data: steps }] = await Promise.all([
        supabase
          .from("cadence_enrollments")
          .select("*, leads(*)")
          .eq("cadence_id", cadenceId)
          .order("enrolled_at", { ascending: false }),
        supabase
          .from("cadence_steps")
          .select("step_order, channel, subject")
          .eq("cadence_id", cadenceId)
          .order("step_order", { ascending: true }),
      ]);

      if (!enrollments?.length) return [];

      const leadIds = enrollments.map((e: any) => e.lead_id);
      const totalSteps = steps?.length || 0;

      // Conversations for these leads
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, lead_id")
        .in("lead_id", leadIds);

      const convIds = (convs || []).map((c) => c.id);
      const convToLead = new Map<string, string>();
      (convs || []).forEach((c: any) => convToLead.set(c.id, c.lead_id));

      const [{ data: msgs }, { data: intents }] = await Promise.all([
        convIds.length
          ? supabase
              .from("messages")
              .select("conversation_id, content, direction, channel, sent_at, metadata")
              .in("conversation_id", convIds)
              .order("sent_at", { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("lead_intents_log")
          .select("lead_id, category, sub_intent, confidence, created_at")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const lastMsgByLead = new Map<string, any>();
      (msgs || []).forEach((m: any) => {
        const lid = convToLead.get(m.conversation_id);
        if (lid && !lastMsgByLead.has(lid)) lastMsgByLead.set(lid, m);
      });

      const lastIntentByLead = new Map<string, any>();
      (intents || []).forEach((i: any) => {
        if (!lastIntentByLead.has(i.lead_id)) lastIntentByLead.set(i.lead_id, i);
      });

      const stepByOrder = new Map<number, any>();
      (steps || []).forEach((s: any) => stepByOrder.set(s.step_order, s));

      return enrollments.map((e: any) => ({
        enrollment: e,
        lead: e.leads,
        lastMessage: lastMsgByLead.get(e.lead_id) || null,
        lastIntent: lastIntentByLead.get(e.lead_id) || null,
        nextStep: stepByOrder.get(e.current_step) || null,
        totalSteps,
      }));
    },
    enabled: !!cadenceId,
  });
}

export function useLeadDrawerData(leadId: string | null, cadenceId: string | null) {
  return useQuery({
    queryKey: ["lead_drawer_data", leadId, cadenceId],
    queryFn: async () => {
      if (!leadId) return null;

      const [{ data: convs }, { data: activities }, { data: decisions }, { data: execLogs }] = await Promise.all([
        supabase.from("conversations").select("id").eq("lead_id", leadId),
        supabase
          .from("lead_activities")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("cadence_agent_decisions")
          .select("*, cadence_enrollments!inner(lead_id, cadence_id)")
          .eq("cadence_enrollments.lead_id", leadId)
          .order("decided_at", { ascending: false })
          .limit(50),
        supabase
          .from("execution_logs")
          .select("*, cadence_steps:step_id(step_order, channel, subject)")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const convIds = (convs || []).map((c) => c.id);
      const { data: messages } = convIds.length
        ? await supabase
            .from("messages")
            .select("*")
            .in("conversation_id", convIds)
            .order("sent_at", { ascending: true })
        : { data: [] as any[] };

      return {
        messages: messages || [],
        activities: activities || [],
        decisions: decisions || [],
        execLogs: execLogs || [],
      };
    },
    enabled: !!leadId,
  });
}
