import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useLeadInsights(leadId: string | null) {
  return useQuery({
    queryKey: ["lead_insights", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("lead_insights")
        .select("*")
        .eq("lead_id", leadId)
        .order("analyzed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
  });
}

/**
 * Batch-fetch the latest lead_insights row for a list of leads.
 * Returns a map keyed by lead_id containing only the most recent row per lead.
 */
export function useLeadInsightsBatch(leadIds: string[]) {
  const key = [...leadIds].sort().join(",");
  return useQuery({
    queryKey: ["lead_insights_batch", key],
    enabled: leadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_insights")
        .select("lead_id, insights, raw_summary, analyzed_at")
        .in("lead_id", leadIds)
        .order("analyzed_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, any> = {};
      for (const row of data || []) {
        if (!map[row.lead_id]) map[row.lead_id] = row; // first is newest
      }
      return map;
    },
  });
}

export function useAnalyzeWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await supabase.functions.invoke("analyze-lead-website", {
        body: { lead_id: leadId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, leadId) => {
      qc.invalidateQueries({ queryKey: ["lead_insights", leadId] });
      toast.success("Análise concluída!");
    },
    onError: (e: any) => toast.error(e.message || "Erro ao analisar website"),
  });
}
