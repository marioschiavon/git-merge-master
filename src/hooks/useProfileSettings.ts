import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface ProfileSettings {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

export function useProfileSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["profile-settings", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ProfileSettings | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, phone")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        user_id: user!.id,
        full_name: data?.full_name ?? null,
        phone: (data as any)?.phone ?? null,
        email: user!.email ?? null,
      };
    },
  });

  const update = useMutation({
    mutationFn: async (patch: { full_name?: string | null; phone?: string | null }) => {
      if (!user?.id) throw new Error("Sem usuário");
      const { error } = await supabase
        .from("profiles")
        .update(patch as any)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil atualizado");
      qc.invalidateQueries({ queryKey: ["profile-settings", user?.id] });
    },
    onError: (e: any) => toast.error(e.message || "Falha ao salvar"),
  });

  return { ...query, update };
}
