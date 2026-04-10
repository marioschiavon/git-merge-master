import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useCadenceDashboardEnrollments(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_dashboard_enrollments", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return [];
      const { data, error } = await supabase
        .from("cadence_enrollments")
        .select("*, leads(name, email, company_name, status)")
        .eq("cadence_id", cadenceId)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!cadenceId,
  });
}

export function useCadenceDashboardLogs(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_dashboard_logs", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return [];
      // Get enrollment ids for this cadence first
      const { data: enrollments } = await supabase
        .from("cadence_enrollments")
        .select("id")
        .eq("cadence_id", cadenceId);
      
      if (!enrollments?.length) return [];
      
      const enrollmentIds = enrollments.map((e) => e.id);
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*, leads(name, email), cadence_steps:step_id(step_order, channel, subject)")
        .in("enrollment_id", enrollmentIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!cadenceId,
  });
}

export function useStepProgressCounts(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_step_progress", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return {};
      const { data, error } = await supabase
        .from("cadence_enrollments")
        .select("current_step")
        .eq("cadence_id", cadenceId);
      if (error) throw error;
      
      const counts: Record<number, number> = {};
      data?.forEach((e) => {
        // Lead has completed all steps before current_step
        for (let s = 1; s < e.current_step; s++) {
          counts[s] = (counts[s] || 0) + 1;
        }
        // Current step counts as "in progress"
        counts[e.current_step] = (counts[e.current_step] || 0) + 1;
      });
      return counts;
    },
    enabled: !!cadenceId,
  });
}
