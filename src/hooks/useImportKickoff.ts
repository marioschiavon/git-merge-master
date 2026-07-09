import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useImportKickoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ transcript, title }: { transcript: string; title?: string }) => {
      const { data, error } = await supabase.functions.invoke("knowledge-import-kickoff", {
        body: { transcript, title },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company_knowledge"] });
      toast.success("Kickoff importado e protegido.");
    },
    onError: (e: any) => toast.error(e.message || "Falha ao importar kickoff"),
  });
}
