import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export type ScoringConfig = {
  scoring_prompt: string | null;
  scoring_include: string[];
  scoring_exclude: string[];
};

export function useScoringConfig() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["company-scoring", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ScoringConfig> => {
      const { data, error } = await supabase
        .from("companies")
        .select("scoring_prompt, scoring_include, scoring_exclude")
        .eq("id", companyId!)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as any;
      return {
        scoring_prompt: row.scoring_prompt ?? null,
        scoring_include: Array.isArray(row.scoring_include) ? row.scoring_include : [],
        scoring_exclude: Array.isArray(row.scoring_exclude) ? row.scoring_exclude : [],
      };
    },
  });
}

export function useUpdateScoringConfig() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<ScoringConfig>) => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { data, error } = await supabase
        .from("companies")
        .update(patch as any)
        .eq("id", companyId)
        .select("scoring_prompt, scoring_include, scoring_exclude")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Você não tem permissão para alterar o critério de qualificação");
      const row = data as any;
      return {
        scoring_prompt: row.scoring_prompt ?? null,
        scoring_include: Array.isArray(row.scoring_include) ? row.scoring_include : [],
        scoring_exclude: Array.isArray(row.scoring_exclude) ? row.scoring_exclude : [],
      } satisfies ScoringConfig;
    },
    onSuccess: (data) => {
      qc.setQueryData(["company-scoring", companyId], data);
      qc.invalidateQueries({ queryKey: ["company-scoring"] });
      toast({ title: "Critério de qualificação salvo" });
    },
    onError: (e: Error) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });
}

export function useEnrichMore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ limit, lead_list_id }: { limit: number; lead_list_id?: string | null }) => {
      const { data, error } = await supabase.functions.invoke("enrichment-enqueue-more", {
        body: { limit, lead_list_id: lead_list_id ?? null },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: boolean; released: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast({
        title: r.released > 0 ? "Enriquecimento iniciado" : "Nenhum lead em espera",
        description: r.released > 0 ? `${r.released} lead(s) enfileirados.` : "Não há leads com status 'em espera'.",
      });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
