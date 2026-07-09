import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AppRole = "master_admin" | "company_admin" | "user";

export interface TeamMember {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  joined_at: string;
}

export interface PendingInvite {
  id: string;
  role: AppRole;
  token: string;
  expires_at: string;
  created_at: string;
  invited_by: string | null;
}

export function useTeamMembers(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["team-members", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_company_members", {
        _company_id: companyId as string,
      });
      if (error) throw error;
      return (data ?? []) as TeamMember[];
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      const { error } = await supabase.rpc("update_company_member_role", {
        _user_id: userId,
        _new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao atualizar papel"),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("remove_company_member", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro removido");
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover membro"),
  });
}

export function usePendingInvites(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["pending-invites", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("company_invites")
        .select("id, role, token, expires_at, created_at, invited_by, accepted_at, cancelled_at")
        .eq("company_id", companyId)
        .is("accepted_at", null)
        .is("cancelled_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingInvite[];
    },
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (role: AppRole) => {
      const { data, error } = await (supabase as any).rpc("create_company_invite", {
        _role: role,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as { id: string; token: string; expires_at: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar convite"),
  });
}

export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await (supabase as any).rpc("cancel_company_invite", {
        _invite_id: inviteId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Convite cancelado");
      qc.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao cancelar convite"),
  });
}

export function buildInviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`;
}
