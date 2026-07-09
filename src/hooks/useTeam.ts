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
