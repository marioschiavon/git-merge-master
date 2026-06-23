import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface LaunchCampaignInput {
  list_id: string;
  cadence_id: string;
  mode: "review" | "auto" | "scheduled";
  scheduled_for?: string | null;
  lead_ids?: string[];
  filters?: { only_enriched?: boolean; require_email?: boolean };
  name?: string;
}

export function useLaunchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LaunchCampaignInput) => {
      const { data, error } = await supabase.functions.invoke("launch-campaign", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: boolean; campaign_id: string; enrolled: number; total: number };
    },
    onSuccess: (data) => {
      toast.success(`Campanha lançada: ${data.enrolled}/${data.total} leads inscritos`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao lançar campanha"),
  });
}

export function useCampaigns(listId?: string | null) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["campaigns", companyId, listId || null],
    queryFn: async () => {
      if (!companyId) return [];
      let q = supabase.from("campaigns" as any).select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      if (listId) q = q.eq("list_id", listId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!companyId,
  });
}
