import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useScriptTemplates() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["script_templates", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("script_templates")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useScriptVariations(templateId: string | null) {
  return useQuery({
    queryKey: ["script_variations", templateId],
    queryFn: async () => {
      if (!templateId) return [];
      const { data, error } = await supabase
        .from("script_variations")
        .select("*")
        .eq("template_id", templateId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!templateId,
  });
}

export function useCreateScript() {
  const qc = useQueryClient();
  const { companyId, user } = useAuth();
  return useMutation({
    mutationFn: async (values: {
      name: string;
      segment: string;
      channel: string;
      tone: string;
      base_script: string;
      is_ai_generated?: boolean;
    }) => {
      if (!companyId || !user) throw new Error("Sem empresa vinculada");
      const { data, error } = await supabase
        .from("script_templates")
        .insert({
          company_id: companyId,
          created_by: user.id,
          name: values.name,
          segment: values.segment,
          channel: values.channel as any,
          tone: values.tone,
          base_script: values.base_script,
          is_ai_generated: values.is_ai_generated || false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["script_templates"] });
      toast.success("Script salvo na biblioteca!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: {
      id: string;
      name: string;
      segment: string;
      channel: string;
      tone: string;
      base_script: string;
    }) => {
      const { error } = await supabase
        .from("script_templates")
        .update({
          name: values.name,
          segment: values.segment,
          channel: values.channel as any,
          tone: values.tone,
          base_script: values.base_script,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["script_templates"] });
      toast.success("Script atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("script_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["script_templates"] });
      toast.success("Script excluído!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useSaveVariations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, variations }: { templateId: string; variations: { tone: string; text: string }[] }) => {
      const rows = variations.map((v) => ({
        template_id: templateId,
        variation_text: v.text,
        tone: v.tone,
      }));
      const { error } = await supabase.from("script_variations").insert(rows);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["script_variations", vars.templateId] });
      toast.success("Variações salvas!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useGenerateScript() {
  return useMutation({
    mutationFn: async (params: { segment: string; channel: string; tone: string; companyContext?: string }) => {
      const { data, error } = await supabase.functions.invoke("ai-generate-script", { body: params });
      if (error) throw error;
      return data as { name: string; subject: string | null; script: string };
    },
    onError: (e: any) => toast.error(e.message || "Erro ao gerar script"),
  });
}

export function useGenerateVariations() {
  return useMutation({
    mutationFn: async (params: { baseScript: string; count?: number; tones?: string[]; segment?: string; channel?: string }) => {
      const { data, error } = await supabase.functions.invoke("ai-variations", { body: params });
      if (error) throw error;
      return data as { variations: { tone: string; text: string }[] };
    },
    onError: (e: any) => toast.error(e.message || "Erro ao gerar variações"),
  });
}
