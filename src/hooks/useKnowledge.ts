import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useKnowledgeItems() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["company_knowledge", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("company_knowledge")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useCreateKnowledge() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (values: { title: string; content: string; type: string; source_url?: string; file_path?: string }) => {
      if (!companyId) throw new Error("Sem empresa vinculada");
      const { data, error } = await supabase
        .from("company_knowledge")
        .insert({ ...values, company_id: companyId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_knowledge"] });
      toast.success("Conhecimento adicionado!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; title?: string; content?: string }) => {
      const { error } = await supabase
        .from("company_knowledge")
        .update(values)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_knowledge"] });
      toast.success("Conhecimento atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("company_knowledge").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_knowledge"] });
      toast.success("Item removido!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useExtractUrl() {
  return useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.functions.invoke("extract-knowledge", {
        body: { url },
      });
      if (error) throw error;
      return data;
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUploadKnowledgeDoc() {
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!companyId) throw new Error("Sem empresa vinculada");
      const filePath = `${companyId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-docs")
        .upload(filePath, file);
      if (uploadError) throw uploadError;
      return filePath;
    },
    onError: (e: any) => toast.error(e.message),
  });
}
