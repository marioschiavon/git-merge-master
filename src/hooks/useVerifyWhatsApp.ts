import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Dispara a verificação de existência dos números no WhatsApp (Hook7/Evolution)
 * para os leads informados. Resultado desconhecido não altera o lead.
 */
export function useVerifyWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("whatsapp-verify-numbers", {
        body: { lead_ids: leadIds },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      const parts = [
        `${data?.valid ?? 0} com WhatsApp`,
        `${data?.invalid ?? 0} sem WhatsApp`,
      ];
      if (data?.unknown) parts.push(`${data.unknown} não verificados`);
      toast.success(parts.join(" · "));
      if (data?.error) toast.warning(data.error);
    },
    onError: (e: any) => toast.error(e.message || "Falha ao verificar números"),
  });
}
