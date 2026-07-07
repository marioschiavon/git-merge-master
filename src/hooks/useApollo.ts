import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export type ApolloStatus = {
  connected: boolean;
  has_key: boolean;
  last_check_at: string | null;
  last_error: string | null;
};

async function invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function useApolloStatus() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["apollo-status", companyId],
    enabled: !!companyId,
    queryFn: () => invoke<ApolloStatus>("apollo-status", { company_id: companyId }),
  });
}

export function useConnectApollo() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: (api_key: string) => invoke("apollo-connect", { api_key, company_id: companyId }),
    onSuccess: () => {
      toast({ title: "Apollo conectado!" });
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["integration", "apollo"] });
    },
    onError: (e: any) => toast({ title: "Erro ao conectar", description: e.message, variant: "destructive" }),
  });
}

export function useDisconnectApollo() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: () => invoke("apollo-disconnect", { company_id: companyId }),
    onSuccess: () => {
      toast({ title: "Apollo desconectado" });
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["integration", "apollo"] });
    },
  });
}

export function useApolloSearch() {
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: (payload: { filters: Record<string, unknown>; page: number }) =>
      invoke("apollo-search", { company_id: companyId, ...payload }),
    onError: (e: any) => toast({ title: "Erro na busca", description: e.message, variant: "destructive" }),
  });
}

export function useApolloImport() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: ({ people, enrich_limit }: { people: any[]; enrich_limit?: number | null }) =>
      invoke("apollo-import", { company_id: companyId, people, enrich_limit: enrich_limit ?? null }),
    onSuccess: (r: any) => {
      const held = r.held ? ` · ${r.held} em espera (sem enriquecer)` : "";
      toast({
        title: "Importação concluída",
        description: `${r.created} criados · ${r.updated} atualizados · ${r.skipped} pulados${held}`,
      });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
    },
    onError: (e: any) => toast({ title: "Erro ao importar", description: e.message, variant: "destructive" }),
  });
}

export const APOLLO_SENIORITIES = [
  "owner", "founder", "c_suite", "partner", "vp", "head", "director",
  "manager", "senior", "entry", "intern",
] as const;

export const APOLLO_EMPLOYEE_RANGES = [
  "1,10", "11,20", "21,50", "51,100", "101,200",
  "201,500", "501,1000", "1001,2000", "2001,5000", "5001,10000", "10001",
] as const;
