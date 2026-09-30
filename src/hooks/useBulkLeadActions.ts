import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type BulkArgs = { lead_ids: string[]; action: "enroll" | "discard" | "delete"; cadence_id?: string | null };

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
        deleted: 0,
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
        totals.deleted += d?.deleted ?? 0;
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
      } else if (args.action === "delete") {
        qc.invalidateQueries({ queryKey: ["lead-lists"] });
        toast.success(`${data?.deleted ?? 0} lead(s) excluídos.`);
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


/** Retorna quais dos leads já tiveram contato (mensagem ou cadência). */
export async function previewLeadDelete(lead_ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < lead_ids.length; i += CHUNK) {
    const { data, error } = await supabase.functions.invoke("leads-bulk-action", {
      body: { action: "delete_preview", lead_ids: lead_ids.slice(i, i + CHUNK) },
    });
    if (error) throw error;
    for (const id of (data as any)?.contacted_ids || []) out.add(id);
  }
  return out;
}

export function useUndoImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (list_id: string) => {
      const { data, error } = await supabase.functions.invoke("leads-bulk-action", { body: { action: "undo_import", list_id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { deleted: number; kept_contacted: number; kept_pre_existing: number };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      const parts = [`Importação desfeita: ${d.deleted} lead(s) apagados`];
      if (d.kept_contacted) parts.push(`${d.kept_contacted} mantidos por já terem sido contatados`);
      if (d.kept_pre_existing) parts.push(`${d.kept_pre_existing} já existiam antes e foram mantidos`);
      toast.success(parts.join(" · "));
    },
    onError: (e: any) => toast.error(e.message || "Não foi possível desfazer a importação"),
  });
}
