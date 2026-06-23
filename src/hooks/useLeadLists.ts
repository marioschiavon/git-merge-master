import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface LeadListRow {
  id: string;
  company_id: string;
  name: string;
  source: string;
  file_name: string | null;
  notes: string | null;
  default_cadence_id: string | null;
  lead_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadListStats extends LeadListRow {
  total: number;
  enriched: number;
  pending_approval: number;
  enriching: number;
  failed: number;
}

export function useLeadLists(opts?: { archived?: boolean }) {
  const { companyId } = useAuth();
  const archived = !!opts?.archived;
  return useQuery({
    queryKey: ["lead-lists", companyId, archived],
    queryFn: async (): Promise<LeadListStats[]> => {
      if (!companyId) return [];
      let q = supabase
        .from("lead_lists" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
      const { data: lists, error } = await q;
      if (error) throw error;
      const ids = (lists || []).map((l: any) => l.id);
      if (ids.length === 0) return [];

      const { data: leads } = await supabase
        .from("leads")
        .select("lead_list_id, enrichment_status")
        .in("lead_list_id", ids);

      const { data: approvals } = await supabase
        .from("approval_requests")
        .select("batch_id, status, kind")
        .in("batch_id", ids)
        .eq("status", "pending");

      const byList = new Map<string, { total: number; enriched: number; enriching: number; failed: number }>();
      for (const id of ids) byList.set(id, { total: 0, enriched: 0, enriching: 0, failed: 0 });
      for (const l of leads || []) {
        const s = byList.get(l.lead_list_id as string);
        if (!s) continue;
        s.total++;
        if (l.enrichment_status === "completed") s.enriched++;
        else if (l.enrichment_status === "pending" || l.enrichment_status === "processing") s.enriching++;
        else if (l.enrichment_status === "failed") s.failed++;
      }
      const pendingByList = new Map<string, number>();
      for (const a of approvals || []) {
        if (!a.batch_id) continue;
        pendingByList.set(a.batch_id, (pendingByList.get(a.batch_id) || 0) + 1);
      }
      return (lists || []).map((l: any) => ({
        ...l,
        total: byList.get(l.id)?.total || 0,
        enriched: byList.get(l.id)?.enriched || 0,
        enriching: byList.get(l.id)?.enriching || 0,
        failed: byList.get(l.id)?.failed || 0,
        pending_approval: pendingByList.get(l.id) || 0,
      }));
    },
    enabled: !!companyId,
  });
}

export function useCreateLeadList() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; source?: string; file_name?: string; notes?: string; default_cadence_id?: string | null }) => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lead_lists" as any)
        .insert({
          company_id: companyId,
          name: input.name,
          source: input.source || "csv",
          file_name: input.file_name || null,
          notes: input.notes || null,
          default_cadence_id: input.default_cadence_id || null,
          created_by: user?.id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as any as LeadListRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-lists"] }),
  });
}

export function useDeleteLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lead_lists" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lista excluída");
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao excluir lista"),
  });
}

export function useRenameLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("lead_lists" as any).update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-lists"] }),
  });
}

export function useArchiveLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const { error } = await supabase
        .from("lead_lists" as any)
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success(vars.archive ? "Lista arquivada" : "Lista desarquivada");
    },
    onError: (e: any) => toast.error(e?.message || "Falha"),
  });
}
