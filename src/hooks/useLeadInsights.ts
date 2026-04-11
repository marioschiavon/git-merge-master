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
