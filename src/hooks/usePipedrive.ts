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
      const parts = [`${data.synced} sincronizados`];
      if (data.removed > 0) parts.push(`${data.removed} removidos`);
      toast({
        title: "Sincronização concluída!",
        description: parts.join(", ") + ".",
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

export type LeadInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  title?: string | null;
  website?: string | null;
  address?: string | null;
  status?: LeadStatus;
  source?: string | null;
};

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async (input: LeadInput) => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { data, error } = await supabase
        .from("leads")
        .insert({
          company_id: companyId,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          company_name: input.company_name || null,
          title: input.title || null,
          website: input.website || null,
          address: input.address || null,
          status: (input.status || "new") as LeadStatus,
          source: input.source || "manual",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead cadastrado!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao cadastrar lead", description: error.message, variant: "destructive" });
    },
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async (leads: LeadInput[]) => {
      if (!companyId) throw new Error("Empresa não identificada");
      if (leads.length === 0) throw new Error("Nenhum lead para importar");

      const rows = leads.map((l) => ({
        company_id: companyId,
        name: l.name,
        email: l.email || null,
        phone: l.phone || null,
        company_name: l.company_name || null,
        title: l.title || null,
        website: l.website || null,
        address: l.address || null,
        status: (l.status || "new") as LeadStatus,
        source: l.source || "csv_import",
      }));

      // Insert in chunks of 500
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error, count } = await supabase
          .from("leads")
          .insert(chunk, { count: "exact" });
        if (error) throw error;
        inserted += count || chunk.length;
      }
      return { inserted };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Importação concluída!", description: `${data.inserted} leads importados.` });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao importar", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.rpc("delete_lead_cascade" as any, { p_lead_id: leadId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead-activities"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["cadence-enrollments"] });
      toast({ title: "Lead excluído", description: "Cadências e mensagens removidas." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir lead", description: error.message, variant: "destructive" });
    },
  });
}
