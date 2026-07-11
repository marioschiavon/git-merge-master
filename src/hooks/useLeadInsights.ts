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
  return useQuery({
    queryKey: ["lead_insights_batch", "all"],
    enabled: leadIds.length > 0,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_insights")
        .select("lead_id, insights, raw_summary, analyzed_at")
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
      // Roda em paralelo: análise (score) + re-scrap forçado das redes.
      const [analyzeRes, enrichRes] = await Promise.allSettled([
        supabase.functions.invoke("analyze-lead-website", { body: { lead_id: leadId } }),
        supabase.functions.invoke("enrich-lead", { body: { lead_id: leadId, force: true } }),
      ]);
      if (analyzeRes.status === "rejected") throw analyzeRes.reason;
      const { data, error } = analyzeRes.value;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return {
        ...data,
        _enrich_ok: enrichRes.status === "fulfilled",
      };
    },
    onSuccess: (data: any, leadId) => {
      qc.invalidateQueries({ queryKey: ["lead_insights", leadId] });
      qc.invalidateQueries({ queryKey: ["lead_insights_batch"] });
      qc.invalidateQueries({ queryKey: ["lead_social_profiles", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });

      const oldS = data?.old_score;
      const newS = data?.new_score;
      const antiFit = data?.anti_fit;
      const excluded: string[] = data?.matched_exclude || [];
      if (antiFit) {
        toast.warning(`Score bloqueado por anti-fit: ${excluded.join(", ")}`, {
          description: `Score fixado em ${newS ?? "—"} pela Qualificação da empresa.`,
        });
      } else if (oldS !== newS) {
        toast.success(`Score atualizado: ${oldS ?? "—"} → ${newS ?? "—"}`, {
          description: "Recalculado com a Qualificação atual.",
        });
      } else {
        toast.info(`Nenhum sinal novo — score mantido em ${newS ?? "—"}`);
      }
    },
    onError: (e: any) => toast.error(e.message || "Erro ao analisar website"),
  });
}
