import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BATCH = 40;

export interface VerifyProgress {
  total: number;
  processed: number;
  percent: number;
}

/**
 * Dispara a verificação de existência dos números no WhatsApp (Hook7/Evolution)
 * para os leads informados. Resultado desconhecido não altera o lead.
 *
 * Seleções grandes são divididas em lotes no cliente: cada requisição verifica
 * no máximo BATCH leads, evitando timeout da edge function.
 */
export function useVerifyWhatsApp() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<VerifyProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async (leadIds: string[]) => {
      const ids = [...new Set(leadIds)];
      const totals = { valid: 0, invalid: 0, unknown: 0, skipped_no_phone: 0 };
      let firstError: string | null = null;

      setProgress({ total: ids.length, processed: 0, percent: 0 });

      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke("whatsapp-verify-numbers", {
          body: { lead_ids: chunk },
        });
        if (error) throw error;
        const res = data as any;
        if (res?.error && !res?.ok) throw new Error(res.error);
        totals.valid += res?.valid ?? 0;
        totals.invalid += res?.invalid ?? 0;
        totals.unknown += res?.unknown ?? 0;
        totals.skipped_no_phone += res?.skipped_no_phone ?? 0;
        if (res?.error && !firstError) firstError = res.error;

        const processed = Math.min(i + chunk.length, ids.length);
        setProgress({
          total: ids.length,
          processed,
          percent: Math.round((processed / ids.length) * 100),
        });
      }

      return { ...totals, error: firstError };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      if (data.valid === 0 && data.invalid === 0) {
        toast.error(
          data.error || "Nenhum número pôde ser verificado. Confira a instância do WhatsApp em Integrações.",
        );
      } else {
        const parts = [`${data.valid} com WhatsApp`, `${data.invalid} sem WhatsApp`];
        if (data.unknown) parts.push(`${data.unknown} não verificados`);
        if (data.skipped_no_phone) parts.push(`${data.skipped_no_phone} sem telefone`);
        toast.success(parts.join(" · "));
        if (data.error) toast.warning(data.error);
      }
      setProgress(null);
    },
    onError: (e: any) => {
      setProgress(null);
      toast.error(e.message || "Falha ao verificar números");
    },
  });

  return Object.assign(mutation, { progress });
}
