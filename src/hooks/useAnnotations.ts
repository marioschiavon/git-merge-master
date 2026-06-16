import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AnnotationRow {
  id: string;
  company_id: string;
  author_user_id: string;
  source_kind: "approval_request" | "cadence_agent_decision";
  source_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  note: string;
  human_action: "approved" | "edited" | "rejected" | "none" | null;
  final_content: string | null;
  context_snapshot: Record<string, any>;
  tags: string[];
  created_at: string;
  updated_at: string;
  leads?: { id: string; name: string | null; company_name: string | null; email: string | null } | null;
}

export interface AnnotationFilters {
  source_kind?: "approval_request" | "cadence_agent_decision" | "all";
  lead_id?: string | null;
  search?: string;
  from?: string | null;
  to?: string | null;
}

export function useAnnotations(filters: AnnotationFilters = {}) {
  return useQuery({
    queryKey: ["annotations", filters],
    queryFn: async () => {
      let q = supabase
        .from("message_annotations" as any)
        .select("*, leads(id, name, company_name, email)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (filters.source_kind && filters.source_kind !== "all") {
        q = q.eq("source_kind", filters.source_kind);
      }
      if (filters.lead_id) q = q.eq("lead_id", filters.lead_id);
      if (filters.search) q = q.ilike("note", `%${filters.search}%`);
      if (filters.from) q = q.gte("created_at", filters.from);
      if (filters.to) q = q.lte("created_at", filters.to);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as AnnotationRow[];
    },
  });
}

export function useAnnotateDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { decision_id: string; note: string }) => {
      const { data, error } = await supabase.functions.invoke("annotate-decision", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
      toast.success("Anotação salva");
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao salvar anotação"),
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("message_annotations" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
      toast.success("Anotação excluída");
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao excluir"),
  });
}
