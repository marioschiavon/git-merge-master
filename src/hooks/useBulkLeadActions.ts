import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type BulkArgs = { lead_ids: string[]; action: "enroll" | "discard"; cadence_id?: string | null };

export function useBulkLeadActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: BulkArgs) => {
      const { data, error } = await supabase.functions.invoke("leads-bulk-action", { body: args });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (data, args) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["cadence-enrollments"] });
      if (args.action === "enroll") {
        toast.success(`${data?.enrolled ?? 0} lead(s) enviados para a cadência${data?.skipped ? ` (${data.skipped} já estavam)` : ""}.`);
      } else {
        toast.success(`${data?.discarded ?? 0} lead(s) descartados.`);
      }
    },
    onError: (e: any) => toast.error(e.message || "Falha na ação em lote"),
  });
}
