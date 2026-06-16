import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ApprovalRow {
  id: string;
  company_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  enrollment_id: string | null;
  cadence_id: string | null;
  kind: "first_message" | "sdr_reply" | "cadence_step" | "sensitive_action";
  channel: string | null;
  action: string;
  payload: Record<string, any>;
  edited_payload: Record<string, any> | null;
  context: Record<string, any>;
  status: "pending" | "approved" | "rejected" | "edited_sent" | "expired" | "failed";
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  executed_at: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
}

export function useApprovals(status: "pending" | "all" = "pending") {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["approvals", status],
    queryFn: async () => {
      let q = supabase
        .from("approval_requests")
        .select("*, leads(id, name, email, company_name), cadences(id, name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (status === "pending") q = q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("approval_requests_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approval_requests" },
        () => {
          qc.invalidateQueries({ queryKey: ["approvals"] });
          qc.invalidateQueries({ queryKey: ["approvals-count"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

export function usePendingApprovalsCount() {
  return useQuery({
    queryKey: ["approvals-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}

export function useApprovalExecute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      approval_id: string;
      action: "approve" | "reject";
      edited_payload?: Record<string, any>;
      rejection_reason?: string;
      note?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("approval-execute", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      toast.success(vars.action === "approve" ? "Aprovação enviada" : "Aprovação rejeitada");
    },
    onError: (e: any) => {
      toast.error(e?.message || "Falha ao processar aprovação");
    },
  });
}

export function useHitlSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["hitl-settings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: member } = await supabase
        .from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
      if (!member) return null;
      const { data: company, error } = await supabase
        .from("companies").select("id, hitl_enabled, hitl_scopes")
        .eq("id", member.company_id).maybeSingle();
      if (error) throw error;
      return company;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: { hitl_enabled?: boolean; hitl_scopes?: Record<string, boolean> }) => {
      const companyId = query.data?.id;
      if (!companyId) throw new Error("sem empresa");
      const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hitl-settings"] });
      toast.success("Preferências salvas");
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao salvar"),
  });

  return { ...query, update };
}
