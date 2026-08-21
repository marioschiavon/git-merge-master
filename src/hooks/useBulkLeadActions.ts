import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type BulkArgs = { lead_ids: string[]; action: "enroll" | "discard"; cadence_id?: string | null };

export type BulkProgress = {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  percent: number;
  error?: string;
};

const CHUNK = 100;

const initialProgress: BulkProgress = { status: "idle", processed: 0, total: 0, percent: 0 };

export function useBulkLeadActions() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BulkProgress>(initialProgress);

  const mutation = useMutation({
    mutationFn: async (args: BulkArgs) => {
      const ids = args.lead_ids;
      const total = ids.length;
      setProgress({ status: "running", processed: 0, total, percent: 0 });

      const totals = {
        enrolled: 0,
        skipped: 0,
        skipped_no_channel: 0,
        discarded: 0,
        cadence_type: undefined as string | undefined,
      };

      for (let i = 0; i < total; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("leads-bulk-action", {
          body: { ...args, lead_ids: part },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const d = data as any;
        totals.enrolled += d?.enrolled ?? 0;
        totals.skipped += d?.skipped ?? 0;
        totals.skipped_no_channel += d?.skipped_no_channel ?? 0;
        totals.discarded += d?.discarded ?? 0;
        if (d?.cadence_type) totals.cadence_type = d.cadence_type;

        const processed = Math.min(i + CHUNK, total);
        setProgress({ status: "running", processed, total, percent: Math.round((processed / total) * 100) });
      }

      setProgress({ status: "done", processed: total, total, percent: 100 });
      return totals;
    },
    onSuccess: (data, args) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["cadence-enrollments"] });
      if (args.action === "enroll") {
        const parts: string[] = [`${data?.enrolled ?? 0} lead(s) enviados para a cadência`];
        if (data?.skipped) parts.push(`${data.skipped} já estavam`);
        if (data?.skipped_no_channel) {
          const label = data.cadence_type === "whatsapp" ? "sem WhatsApp" : data.cadence_type === "email" ? "sem e-mail" : "sem canal";
          parts.push(`${data.skipped_no_channel} ${label}`);
        }
        toast.success(parts.join(" · "));
      } else {
        toast.success(`${data?.discarded ?? 0} lead(s) descartados.`);
      }
    },
    onError: (e: any) => {
      setProgress((p) => ({ ...p, status: "error", error: e?.message || "Falha na ação em lote" }));
      toast.error(e.message || "Falha na ação em lote");
    },
  });

  return Object.assign(mutation, {
    progress,
    resetProgress: () => setProgress(initialProgress),
  });
}
