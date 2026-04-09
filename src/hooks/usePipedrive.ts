import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type IntegrationProvider = "pipedrive";
type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted";

export function useIntegration(provider: IntegrationProvider) {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["integration", provider, companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", provider)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useConnectPipedrive() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async (apiToken: string) => {
      const { data, error } = await supabase.functions.invoke("pipedrive-connect", {
        body: { api_token: apiToken, company_id: companyId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integration", "pipedrive"] });
      toast({
        title: "Pipedrive conectado!",
        description: `Usuário: ${data.pipedrive_user}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao conectar",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDisconnectPipedrive() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("integrations")
        .update({ status: "inactive" } as any)
        .eq("company_id", companyId!)
        .eq("provider", "pipedrive");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "pipedrive"] });
      toast({ title: "Pipedrive desconectado" });
    },
  });
}

export function useLeads(filters?: { status?: string; search?: string }) {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["leads", companyId, filters],
    queryFn: async () => {
      if (!companyId) return [];
      let query = supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status as LeadStatus);
      }
      if (filters?.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company_name.ilike.%${filters.search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useLeadActivities(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-activities", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_activities")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!leadId,
  });
}

export function useSyncLeads() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipedrive-sync", {
        body: { company_id: companyId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({
        title: "Sincronização concluída!",
        description: `${data.synced} leads sincronizados.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro na sincronização",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
