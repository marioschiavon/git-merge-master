import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type CadencePolicy = {
  cadence_id: string;
  company_id: string;
  goal: string;
  max_attempts: number;
  max_days: number;
  allowed_channels: string[];
  primary_channel: string;
  tone_instructions: string;
  continue_criteria: string | null;
  stop_criteria_flags: Record<string, boolean>;
  stop_criteria_text: string | null;
  min_fit_score: number | null;
  business_hours: { start: string; end: string; days: number[]; tz: string };
};

export function useCadencePolicy(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_policy", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return null;
      const { data, error } = await supabase
        .from("cadence_policies" as any)
        .select("*")
        .eq("cadence_id", cadenceId)
        .maybeSingle();
      if (error) throw error;
      return data as any as CadencePolicy | null;
    },
    enabled: !!cadenceId,
  });
}

export function useUpsertCadencePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<CadencePolicy> & { cadence_id: string; company_id: string }) => {
      const { error } = await supabase.from("cadence_policies" as any).upsert(p as any, { onConflict: "cadence_id" });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["cadence_policy", vars.cadence_id] });
      toast.success("Política salva!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAgentDecisions(enrollmentId: string | null) {
  return useQuery({
    queryKey: ["agent_decisions", enrollmentId],
    queryFn: async () => {
      if (!enrollmentId) return [];
      const { data, error } = await supabase
        .from("cadence_agent_decisions" as any)
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .order("decided_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!enrollmentId,
  });
}

export function useAllAgentDecisions(cadenceId: string | null) {
  return useQuery({
    queryKey: ["agent_decisions_cadence", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return [];
      // Get all enrollments of this cadence, then their decisions
      const { data: enrolls } = await supabase
        .from("cadence_enrollments")
        .select("id, lead_id, leads(name)")
        .eq("cadence_id", cadenceId);
      if (!enrolls || enrolls.length === 0) return [];
      const ids = enrolls.map((e: any) => e.id);
      const { data: decisions, error } = await supabase
        .from("cadence_agent_decisions" as any)
        .select("*")
        .in("enrollment_id", ids)
        .order("decided_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const leadByEnroll: Record<string, string> = {};
      enrolls.forEach((e: any) => (leadByEnroll[e.id] = e.leads?.name || "Lead"));
      return (decisions as any[]).map((d) => ({ ...d, lead_name: leadByEnroll[d.enrollment_id] }));
    },
    enabled: !!cadenceId,
  });
}
